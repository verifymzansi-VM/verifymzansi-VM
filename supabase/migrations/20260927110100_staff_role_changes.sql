-- Staff role changes with independent approval.
--
-- Role changes are decision records (action_category 'role_change',
-- case_type 'staff_role'). Each RPC validates the actor, the target, the
-- current state and the approval policy, then writes the role, the decision
-- event, the role history row and the audit row in one transaction.
--
-- Policy (docs: admin rebuild plan, section 5):
--   * Promotion to moderator:          proposed by an admin, approved by an
--                                       independent governor or admin.
--   * Promotion to governor or admin:  proposed by an admin, approved by a
--                                       second, independent admin.
--   * Demotion / revocation by admin:  takes effect immediately.
--   * A governor may propose removing a moderator; an admin approves it.
--   * Nobody changes their own role. The last active admin cannot be removed
--     (staff_roles trigger). Proposals expire after 7 days.
--
-- These functions are service-role only. The actor is passed in by the
-- server route after it has verified the session; it is re-checked here
-- against staff_roles, never taken from auth.uid().

ALTER TYPE public.decision_status ADD VALUE IF NOT EXISTS 'expired';

BEGIN;

ALTER TABLE public.decision_records
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS payload_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS decision_records_one_pending_role_change
  ON public.decision_records (case_id)
  WHERE case_type = 'staff_role' AND status = 'pending_approval';

CREATE TABLE IF NOT EXISTS public.decision_approvals (
  decision_id     uuid NOT NULL REFERENCES public.decision_records(id),
  approver_id     uuid NOT NULL REFERENCES auth.users(id),
  approver_role   text NOT NULL,
  payload_version integer NOT NULL,
  approved_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (decision_id, approver_id)
);

ALTER TABLE public.decision_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.decision_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.decision_approvals TO authenticated;
GRANT ALL ON public.decision_approvals TO service_role;
CREATE POLICY "staff_read_decision_approvals" ON public.decision_approvals
  FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role(ARRAY['moderator', 'governance_controller', 'admin'])));

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('staff_mfa_enforced', true,
   'Require staff to use an authenticator app. Each staff member has a 7-day enrolment grace period (staff_roles.mfa_required_after); sensitive actions always need a recent second factor.')
ON CONFLICT (key) DO NOTHING;

-- ── Helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE p_role
    WHEN 'admin' THEN 3
    WHEN 'governance_controller' THEN 2
    WHEN 'moderator' THEN 1
    ELSE 0
  END;
$$;

-- Exact, case-insensitive email lookup for role changes (replaces paging
-- through every auth user from the API).
CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_user_exists(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user);
$$;

CREATE OR REPLACE FUNCTION public.apply_staff_role_internal(
  p_target uuid,
  p_new_role text,
  p_actor uuid,
  p_actor_role text,
  p_reason text,
  p_decision uuid
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous text;
BEGIN
  SELECT role INTO v_previous
    FROM public.staff_roles
   WHERE user_id = p_target AND status = 'active'
   FOR UPDATE;
  v_previous := coalesce(v_previous, 'member');

  IF p_new_role = 'member' THEN
    UPDATE public.staff_roles
       SET status = 'revoked', revoked_at = now(), revoked_by = p_actor, revoked_reason = p_reason
     WHERE user_id = p_target AND status = 'active';
  ELSE
    INSERT INTO public.staff_roles AS sr (user_id, role, status, granted_by, granted_at)
    VALUES (p_target, p_new_role, 'active', p_actor, now())
    ON CONFLICT (user_id) DO UPDATE
      SET role = EXCLUDED.role,
          status = 'active',
          granted_by = EXCLUDED.granted_by,
          granted_at = EXCLUDED.granted_at,
          revoked_by = NULL,
          revoked_at = NULL,
          revoked_reason = NULL,
          -- A returning staff member gets a fresh enrolment grace period.
          mfa_required_after = CASE WHEN sr.status = 'revoked'
                                    THEN now() + interval '7 days'
                                    ELSE sr.mfa_required_after END;
  END IF;

  INSERT INTO public.role_assignments_history (target_user_id, previous_role, new_role, assigned_by, reason)
  VALUES (p_target, v_previous, p_new_role, p_actor, p_reason);

  INSERT INTO public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata,
                                 previous_value, new_value, reason)
  VALUES (p_actor, p_actor_role,
          CASE WHEN p_new_role = 'member' THEN 'role_revoked' ELSE 'role_assigned' END,
          'user', p_target, jsonb_build_object('decision_id', p_decision),
          to_jsonb(v_previous), to_jsonb(p_new_role), p_reason);

  RETURN v_previous;
END;
$$;

-- Who may approve a proposal to move p_target from p_from to p_to.
CREATE OR REPLACE FUNCTION public.role_change_approver_allowed(p_from text, p_to text, p_approver_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(CASE
    WHEN p_to = 'moderator' AND public.staff_role_rank(p_to) > public.staff_role_rank(p_from)
      THEN p_approver_role IN ('governance_controller', 'admin')
    ELSE p_approver_role = 'admin'
  END, false);
$$;

-- ── propose ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propose_staff_role_change(
  p_actor uuid,
  p_target uuid,
  p_role text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_role text := public.staff_role_of(p_actor);
  v_current text;
  v_decision uuid;
  v_previous text;
BEGIN
  IF v_actor_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_role NOT IN ('moderator', 'governance_controller', 'admin', 'member') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_role');
  END IF;
  IF p_target = p_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_change');
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;
  IF NOT public.auth_user_exists(p_target) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_not_found');
  END IF;

  SELECT coalesce(
           (SELECT role FROM public.staff_roles WHERE user_id = p_target AND status = 'active'),
           'member')
    INTO v_current;
  IF v_current = p_role THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_change');
  END IF;

  -- Demotion by an admin takes effect immediately.
  IF public.staff_role_rank(p_role) < public.staff_role_rank(v_current) AND v_actor_role = 'admin' THEN
    INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
      recommendation, rationale, before_state, after_state, payload, approver_id, approval_rationale, decided_at)
    VALUES ('staff_role', p_target::text, 'role_change', 'approved', p_actor, p_role, p_reason,
      jsonb_build_object('role', v_current), jsonb_build_object('role', p_role),
      jsonb_build_object('target_user_id', p_target, 'from_role', v_current, 'to_role', p_role),
      p_actor, p_reason, now())
    RETURNING id INTO v_decision;
    v_previous := public.apply_staff_role_internal(p_target, p_role, p_actor, v_actor_role, p_reason, v_decision);
    INSERT INTO public.decision_record_events (decision_id, actor_id, actor_role, event_type, detail)
    VALUES (v_decision, p_actor, v_actor_role, 'applied',
            jsonb_build_object('from_role', v_previous, 'to_role', p_role));
    RETURN jsonb_build_object('ok', true, 'status', 'applied', 'decision_id', v_decision,
                              'target_user_id', p_target, 'previous_role', v_previous, 'new_role', p_role);
  END IF;

  -- Everything else is a proposal: promotions by an admin, and a governor
  -- asking for a moderator's removal.
  IF NOT (
    (v_actor_role = 'admin' AND public.staff_role_rank(p_role) > public.staff_role_rank(v_current))
    OR (v_actor_role = 'governance_controller' AND v_current = 'moderator' AND p_role = 'member')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF EXISTS (SELECT 1 FROM public.decision_records
              WHERE case_type = 'staff_role' AND case_id = p_target::text AND status = 'pending_approval') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_exists');
  END IF;

  INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
    recommendation, rationale, before_state, payload, payload_version, expires_at)
  VALUES ('staff_role', p_target::text, 'role_change', 'pending_approval', p_actor, p_role, p_reason,
    jsonb_build_object('role', v_current),
    jsonb_build_object('target_user_id', p_target, 'from_role', v_current, 'to_role', p_role),
    1, now() + interval '7 days')
  RETURNING id INTO v_decision;

  INSERT INTO public.decision_record_events (decision_id, actor_id, actor_role, event_type, detail)
  VALUES (v_decision, p_actor, v_actor_role, 'proposed',
          jsonb_build_object('from_role', v_current, 'to_role', p_role));

  INSERT INTO public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, reason)
  VALUES (p_actor, v_actor_role, 'role_change_proposed', 'user', p_target,
          jsonb_build_object('decision_id', v_decision, 'from_role', v_current, 'to_role', p_role), p_reason);

  RETURN jsonb_build_object('ok', true, 'status', 'proposed', 'decision_id', v_decision,
                            'target_user_id', p_target, 'previous_role', v_current, 'new_role', p_role);
END;
$$;

-- ── approve ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_staff_role_change(
  p_actor uuid,
  p_decision uuid,
  p_payload_version integer,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_role text := public.staff_role_of(p_actor);
  d public.decision_records%ROWTYPE;
  v_target uuid;
  v_from text;
  v_to text;
  v_current text;
  v_proposer_role text;
  v_previous text;
BEGIN
  SELECT * INTO d FROM public.decision_records WHERE id = p_decision FOR UPDATE;
  IF NOT FOUND OR d.case_type <> 'staff_role' OR d.action_category <> 'role_change' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF d.status <> 'pending_approval' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  v_target := (d.payload->>'target_user_id')::uuid;
  v_from := d.payload->>'from_role';
  v_to := d.payload->>'to_role';

  IF d.expires_at IS NOT NULL AND d.expires_at <= now() THEN
    UPDATE public.decision_records SET status = 'expired', updated_at = now(), decided_at = now()
     WHERE id = p_decision;
    INSERT INTO public.decision_record_events (decision_id, actor_id, actor_role, event_type, detail)
    VALUES (p_decision, p_actor, coalesce(v_actor_role, 'unknown'), 'expired', '{}'::jsonb);
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF p_actor = d.recommender_id OR p_actor = v_target THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_independent');
  END IF;
  IF v_actor_role IS NULL OR NOT public.role_change_approver_allowed(v_from, v_to, v_actor_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_payload_version IS DISTINCT FROM d.payload_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payload_changed');
  END IF;

  -- The proposer must still hold the authority to have proposed this.
  v_proposer_role := coalesce(public.staff_role_of(d.recommender_id), 'member');
  IF NOT (
    v_proposer_role = 'admin'
    OR (v_proposer_role = 'governance_controller' AND v_from = 'moderator' AND v_to = 'member')
  ) THEN
    UPDATE public.decision_records SET status = 'cancelled', updated_at = now(), decided_at = now()
     WHERE id = p_decision;
    INSERT INTO public.decision_record_events (decision_id, actor_id, actor_role, event_type, detail)
    VALUES (p_decision, p_actor, v_actor_role, 'cancelled', '{"reason":"proposer_lost_authority"}'::jsonb);
    RETURN jsonb_build_object('ok', false, 'error', 'proposer_lost_authority');
  END IF;

  -- The target's role must not have changed since the proposal.
  SELECT coalesce(
           (SELECT role FROM public.staff_roles WHERE user_id = v_target AND status = 'active'),
           'member')
    INTO v_current;
  IF v_current <> v_from THEN
    UPDATE public.decision_records SET status = 'cancelled', updated_at = now(), decided_at = now()
     WHERE id = p_decision;
    INSERT INTO public.decision_record_events (decision_id, actor_id, actor_role, event_type, detail)
    VALUES (p_decision, p_actor, v_actor_role, 'cancelled',
            jsonb_build_object('reason', 'stale', 'current_role', v_current));
    RETURN jsonb_build_object('ok', false, 'error', 'stale');
  END IF;

  INSERT INTO public.decision_approvals (decision_id, approver_id, approver_role, payload_version)
  VALUES (p_decision, p_actor, v_actor_role, d.payload_version);

  v_previous := public.apply_staff_role_internal(v_target, v_to, p_actor, v_actor_role, d.rationale, p_decision);

  UPDATE public.decision_records
     SET status = 'approved', approver_id = p_actor, approval_rationale = p_note,
         after_state = jsonb_build_object('role', v_to), decided_at = now(), updated_at = now()
   WHERE id = p_decision;

  INSERT INTO public.decision_record_events (decision_id, actor_id, actor_role, event_type, detail)
  VALUES (p_decision, p_actor, v_actor_role, 'approved',
          jsonb_build_object('from_role', v_previous, 'to_role', v_to, 'note', p_note));

  RETURN jsonb_build_object('ok', true, 'status', 'applied', 'decision_id', p_decision,
                            'target_user_id', v_target, 'previous_role', v_previous, 'new_role', v_to);
END;
$$;

-- ── reject / withdraw ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_staff_role_change(
  p_actor uuid,
  p_decision uuid,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_role text := public.staff_role_of(p_actor);
  d public.decision_records%ROWTYPE;
  v_withdraw boolean;
BEGIN
  SELECT * INTO d FROM public.decision_records WHERE id = p_decision FOR UPDATE;
  IF NOT FOUND OR d.case_type <> 'staff_role' OR d.action_category <> 'role_change' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF d.status <> 'pending_approval' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;
  IF v_actor_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_withdraw := p_actor = d.recommender_id;
  IF NOT v_withdraw AND NOT public.role_change_approver_allowed(
       d.payload->>'from_role', d.payload->>'to_role', v_actor_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.decision_records
     SET status = CASE WHEN v_withdraw THEN 'cancelled'::public.decision_status
                       ELSE 'rejected'::public.decision_status END,
         approver_id = CASE WHEN v_withdraw THEN approver_id ELSE p_actor END,
         approval_rationale = p_note, decided_at = now(), updated_at = now()
   WHERE id = p_decision;

  INSERT INTO public.decision_record_events (decision_id, actor_id, actor_role, event_type, detail)
  VALUES (p_decision, p_actor, v_actor_role, CASE WHEN v_withdraw THEN 'withdrawn' ELSE 'rejected' END,
          jsonb_build_object('note', p_note));

  INSERT INTO public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, reason)
  VALUES (p_actor, v_actor_role, 'role_assignment_reviewed', 'user', (d.payload->>'target_user_id')::uuid,
          jsonb_build_object('decision_id', p_decision, 'outcome',
                             CASE WHEN v_withdraw THEN 'withdrawn' ELSE 'rejected' END), p_note);

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_withdraw THEN 'withdrawn' ELSE 'rejected' END);
END;
$$;

-- ── Owner provisioning ──────────────────────────────────────────────────
-- Used only by the owner-run `pnpm bootstrap:operator` script (service key),
-- for the first admins and for recovery when no second admin can approve.
-- Recorded with a distinct audit action so every use is visible.
CREATE OR REPLACE FUNCTION public.provision_staff_role_by_owner(
  p_target uuid,
  p_role text,
  p_reason text
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_previous text;
BEGIN
  IF p_role NOT IN ('moderator', 'governance_controller', 'admin') THEN
    RAISE EXCEPTION 'Unsupported staff role: %', p_role;
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Owner provisioning needs a written reason (at least 10 characters)';
  END IF;
  IF NOT public.auth_user_exists(p_target) THEN
    RAISE EXCEPTION 'No auth user %', p_target;
  END IF;

  SELECT role INTO v_previous FROM public.staff_roles WHERE user_id = p_target AND status = 'active';

  INSERT INTO public.staff_roles AS sr (user_id, role, status, granted_by, granted_at)
  VALUES (p_target, p_role, 'active', NULL, now())
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active', granted_by = NULL, granted_at = now(),
        revoked_by = NULL, revoked_at = NULL, revoked_reason = NULL,
        mfa_required_after = CASE WHEN sr.status = 'revoked'
                                  THEN now() + interval '7 days'
                                  ELSE sr.mfa_required_after END;

  -- There is no in-app actor; the history row names the person provisioned.
  INSERT INTO public.role_assignments_history (target_user_id, previous_role, new_role, assigned_by, reason)
  VALUES (p_target, coalesce(v_previous, 'member'), p_role, p_target, 'Owner provisioning: ' || p_reason);

  INSERT INTO public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata,
                                 previous_value, new_value, reason)
  VALUES ('00000000-0000-0000-0000-000000000000', 'system', 'role_provisioned_by_owner', 'user', p_target,
          jsonb_build_object('source', 'bootstrap-operator'),
          to_jsonb(coalesce(v_previous, 'member')), to_jsonb(p_role), p_reason);

  RETURN coalesce(v_previous, 'member');
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.staff_role_rank(text),
  public.auth_user_id_by_email(text),
  public.auth_user_exists(uuid),
  public.apply_staff_role_internal(uuid, text, uuid, text, text, uuid),
  public.role_change_approver_allowed(text, text, text),
  public.propose_staff_role_change(uuid, uuid, text, text),
  public.approve_staff_role_change(uuid, uuid, integer, text),
  public.reject_staff_role_change(uuid, uuid, text),
  public.provision_staff_role_by_owner(uuid, text, text)
FROM PUBLIC, anon, authenticated;

-- The RPCs run as the service role (SECURITY INVOKER), so it also needs the
-- internal helpers they call.
GRANT EXECUTE ON FUNCTION
  public.staff_role_rank(text),
  public.auth_user_id_by_email(text),
  public.auth_user_exists(uuid),
  public.apply_staff_role_internal(uuid, text, uuid, text, text, uuid),
  public.role_change_approver_allowed(text, text, text),
  public.propose_staff_role_change(uuid, uuid, text, text),
  public.approve_staff_role_change(uuid, uuid, integer, text),
  public.reject_staff_role_change(uuid, uuid, text),
  public.provision_staff_role_by_owner(uuid, text, text)
TO service_role;

COMMIT;
