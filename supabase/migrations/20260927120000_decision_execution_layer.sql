-- Decision execution layer.
--
-- Before this migration an enforcement decision was a series of separate API
-- writes: the account status, a best-effort hide of the owner's content, a
-- moderation log row and an audit call. A failure part-way left an approved
-- decision with an unapplied effect, restoring an account restored content by
-- timestamp (republishing items hidden for other reasons), warnings silently
-- lifted bans, and appeals changed nothing.
--
-- Now every decision commits its state change, its recorded effects, its
-- events and its audit row in one transaction:
--   * account_restrictions  — each warning, suspension and ban, linked to the
--                             decision that imposed it and the one that lifted it.
--   * content_effects       — each content row a decision hid, with its prior
--                             status, so lifting reverts exactly that decision.
--   * recompute_account_status() — the only writer of account_status.
--   * operation_jobs        — durable, idempotent jobs for effects outside
--                             PostgreSQL (email notices, auth metadata sync).
--   * ops_events            — durable incident log (replaces in-memory counters).
--   * expire_due_items()    — pg_cron job: lifts ended restrictions, lapses
--                             emergency suspensions, expires stale proposals.
--   * Appeals: members submit through submit_appeal(); resolve_appeal() lifts
--     only the appealed decision's restrictions and effects.
--   * audit_logs, decision_record_events and role_assignments_history are
--     append-only (application level: a database owner can still alter
--     triggers). The only exceptions are the 24-month retention purge and the
--     audited POPIA redaction function.
--
-- All RPCs are service-role only and take the acting staff member from the
-- server route, re-checked here against staff_roles.

ALTER TYPE public.sensitive_action_category ADD VALUE IF NOT EXISTS 'account_warning';
ALTER TYPE public.enforcement_action ADD VALUE IF NOT EXISTS 'lift';

BEGIN;

-- ── 1. The ledger outlives account deletion ─────────────────────────────
-- Decision, appeal and role-history rows keep a pseudonymous user id instead
-- of being deleted with the account.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname
      FROM pg_constraint
     WHERE contype = 'f'
       AND confrelid = 'auth.users'::regclass
       AND conrelid IN ('public.decision_records'::regclass, 'public.decision_record_events'::regclass,
                        'public.appeal_cases'::regclass, 'public.role_assignments_history'::regclass,
                        'public.decision_approvals'::regclass, 'public.moderation_actions'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

-- System decisions (expiry, legacy backfill) have no human recommender.
ALTER TABLE public.decision_records ALTER COLUMN recommender_id DROP NOT NULL;
ALTER TABLE public.decision_record_events ALTER COLUMN actor_id DROP NOT NULL;

ALTER TABLE public.decision_records
  ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'not_required'
    CHECK (execution_status IN ('not_required', 'pending', 'succeeded', 'failed')),
  ADD COLUMN IF NOT EXISTS execution_error text,
  ADD COLUMN IF NOT EXISTS executed_at timestamptz;

CREATE INDEX IF NOT EXISTS decision_records_pending_expiry_idx
  ON public.decision_records (expires_at) WHERE status = 'pending_approval';
CREATE INDEX IF NOT EXISTS decision_records_execution_idx
  ON public.decision_records (execution_status) WHERE execution_status IN ('pending', 'failed');

-- ── 2. Restrictions and effects ─────────────────────────────────────────
CREATE TABLE public.account_restrictions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id           uuid NOT NULL REFERENCES public.decision_records(id),
  user_id               uuid NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('warning', 'suspension', 'ban')),
  reason                text NOT NULL,
  starts_at             timestamptz NOT NULL DEFAULT now(),
  -- NULL: until lifted (bans, and legacy suspensions recorded without an end).
  ends_at               timestamptz,
  emergency             boolean NOT NULL DEFAULT false,
  lifted_at             timestamptz,
  lifted_by             uuid,
  lifted_by_decision_id uuid REFERENCES public.decision_records(id),
  lift_reason           text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_restrictions_user_open_idx
  ON public.account_restrictions (user_id) WHERE lifted_at IS NULL;
CREATE INDEX account_restrictions_due_idx
  ON public.account_restrictions (ends_at) WHERE lifted_at IS NULL AND ends_at IS NOT NULL;
CREATE INDEX account_restrictions_decision_idx ON public.account_restrictions (decision_id);

CREATE TABLE public.content_effects (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id             uuid NOT NULL REFERENCES public.decision_records(id),
  -- Set when the effect exists because of an account restriction; it is
  -- reverted when no restriction on the owner is active any more.
  restriction_id          uuid REFERENCES public.account_restrictions(id),
  table_name              text NOT NULL CHECK (table_name IN ('listings', 'businesses', 'promotions')),
  row_id                  uuid NOT NULL,
  owner_id                uuid NOT NULL,
  prior_status            text NOT NULL,
  applied_status          text NOT NULL,
  applied_at              timestamptz NOT NULL DEFAULT now(),
  reverted_at             timestamptz,
  reverted_by_decision_id uuid REFERENCES public.decision_records(id),
  revert_outcome          text
);
CREATE INDEX content_effects_open_row_idx
  ON public.content_effects (table_name, row_id) WHERE reverted_at IS NULL;
CREATE INDEX content_effects_restriction_idx
  ON public.content_effects (restriction_id) WHERE reverted_at IS NULL;
CREATE INDEX content_effects_decision_idx ON public.content_effects (decision_id);

-- ── 3. Durable operations ───────────────────────────────────────────────
CREATE TABLE public.ops_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid
);
CREATE INDEX ops_events_open_idx ON public.ops_events (created_at DESC) WHERE acknowledged_at IS NULL;

CREATE TABLE public.ops_heartbeats (
  name        text PRIMARY KEY,
  last_run_at timestamptz NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.operation_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key text NOT NULL UNIQUE,
  kind          text NOT NULL CHECK (kind IN ('email_notice', 'auth_metadata_sync', 'storage_delete')),
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'dead')),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 6,
  next_run_at   timestamptz NOT NULL DEFAULT now(),
  locked_until  timestamptz,
  last_error    text,
  decision_id   uuid REFERENCES public.decision_records(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX operation_jobs_runnable_idx ON public.operation_jobs (next_run_at) WHERE status IN ('pending', 'running');
CREATE INDEX operation_jobs_dead_idx ON public.operation_jobs (updated_at DESC) WHERE status = 'dead';

-- Staff read access; members read only their own restrictions (for /banned
-- and appeals). All writes go through the RPCs below.
ALTER TABLE public.account_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_restrictions, public.content_effects, public.ops_events,
  public.ops_heartbeats, public.operation_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_restrictions, public.content_effects TO authenticated;
GRANT SELECT ON public.ops_events, public.ops_heartbeats, public.operation_jobs TO authenticated;
GRANT ALL ON public.account_restrictions, public.content_effects, public.ops_events,
  public.ops_heartbeats, public.operation_jobs TO service_role;

CREATE POLICY "Owner or staff read restrictions" ON public.account_restrictions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR (SELECT public.has_any_role(ARRAY['moderator', 'governance_controller', 'admin'])));
CREATE POLICY "Owner or staff read content effects" ON public.content_effects
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid())
         OR (SELECT public.has_any_role(ARRAY['moderator', 'governance_controller', 'admin'])));
CREATE POLICY "Governance reads ops events" ON public.ops_events
  FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role(ARRAY['governance_controller', 'admin'])));
CREATE POLICY "Governance reads heartbeats" ON public.ops_heartbeats
  FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role(ARRAY['governance_controller', 'admin'])));
CREATE POLICY "Governance reads jobs" ON public.operation_jobs
  FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role(ARRAY['governance_controller', 'admin'])));

-- Members can read their own appeals (the status page for an appeal).
DROP POLICY IF EXISTS "Appellant reads own appeals" ON public.appeal_cases;
CREATE POLICY "Appellant reads own appeals" ON public.appeal_cases
  FOR SELECT TO authenticated
  USING (appellant_id = (SELECT auth.uid()));
GRANT SELECT ON public.appeal_cases TO authenticated;

-- ── 4. Small helpers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_ops_event(p_kind text, p_severity text, p_detail jsonb)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.ops_events (kind, severity, detail) VALUES (p_kind, p_severity, coalesce(p_detail, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.enqueue_operation_job(
  p_key text, p_kind text, p_payload jsonb, p_decision uuid
) RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.operation_jobs (operation_key, kind, payload, decision_id)
  VALUES (p_key, p_kind, p_payload, p_decision)
  ON CONFLICT (operation_key) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.is_decision_staff(p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(p_role IN ('governance_controller', 'admin'), false);
$$;

CREATE OR REPLACE FUNCTION public.decision_event(
  p_decision uuid, p_actor uuid, p_actor_role text, p_event text, p_detail jsonb
) RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.decision_record_events (decision_id, actor_id, actor_role, event_type, detail)
  VALUES (p_decision, p_actor, coalesce(p_actor_role, 'system'), p_event, coalesce(p_detail, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.decision_audit(
  p_actor uuid, p_actor_role text, p_action text, p_target_type text, p_target uuid,
  p_metadata jsonb, p_reason text
) RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  INSERT INTO public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, reason)
  VALUES (coalesce(p_actor, '00000000-0000-0000-0000-000000000000'), coalesce(p_actor_role, 'system'),
          p_action, p_target_type, coalesce(p_target, '00000000-0000-0000-0000-000000000000'),
          coalesce(p_metadata, '{}'::jsonb), p_reason);
$$;

-- The owner and content table behind a report target.
CREATE OR REPLACE FUNCTION public.report_target_owner(p_target_type text, p_target_id uuid)
RETURNS TABLE (owner_id uuid, table_name text)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_target_type = 'listing' THEN
    RETURN QUERY SELECT l.owner_id, 'listings'::text FROM public.listings l WHERE l.id = p_target_id;
  ELSIF p_target_type IN ('business', 'storefront', 'business_profile') THEN
    RETURN QUERY SELECT b.owner_id, 'businesses'::text FROM public.businesses b WHERE b.id = p_target_id;
  ELSIF p_target_type = 'promotion' THEN
    RETURN QUERY SELECT p.owner_id, 'promotions'::text FROM public.promotions p WHERE p.id = p_target_id;
  ELSIF p_target_type = 'account_profile' THEN
    RETURN QUERY SELECT p_target_id, NULL::text;
  END IF;
END;
$$;

-- ── 5. Account status: one writer ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_account_status(p_user uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ban public.account_restrictions%ROWTYPE;
  v_suspended_until timestamptz;
  v_has_suspension boolean;
  v_current text;
  v_next text;
BEGIN
  SELECT * INTO v_ban FROM public.account_restrictions
   WHERE user_id = p_user AND kind = 'ban' AND lifted_at IS NULL
   ORDER BY starts_at DESC LIMIT 1;

  SELECT bool_or(true), max(ends_at) INTO v_has_suspension, v_suspended_until
    FROM public.account_restrictions
   WHERE user_id = p_user AND kind = 'suspension' AND lifted_at IS NULL
     AND (ends_at IS NULL OR ends_at > now());

  SELECT account_status::text INTO v_current FROM public.account_profiles WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_next := CASE
    WHEN v_ban.id IS NOT NULL THEN 'banned'
    WHEN coalesce(v_has_suspension, false) THEN 'suspended'
    -- Warnings never change status; a legacy 'warned' label is left alone.
    WHEN v_current = 'warned' THEN 'warned'
    ELSE 'active'
  END;

  PERFORM set_config('app.account_status_writer', 'recompute', true);
  UPDATE public.account_profiles
     SET account_status = v_next::public.account_status,
         suspended_until = CASE WHEN v_next = 'suspended' THEN v_suspended_until ELSE NULL END,
         banned_at = CASE WHEN v_next = 'banned' THEN coalesce(banned_at, v_ban.starts_at) ELSE NULL END,
         ban_reason = CASE WHEN v_next = 'banned' THEN v_ban.reason ELSE NULL END
   WHERE user_id = p_user;
  PERFORM set_config('app.account_status_writer', '', true);

  RETURN v_next;
END;
$$;

-- account_status, suspended_until, banned_at, ban_reason and strikes may only
-- be written by recompute_account_status()/strike changes (which set the
-- writer flag) or by trusted contexts with no API role (migrations, pg_cron).
-- The service role and admins can no longer write them directly.
CREATE OR REPLACE FUNCTION public.guard_account_enforcement_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  status_writer boolean := auth.role() IS NULL
    OR current_setting('app.account_status_writer', true) = 'recompute';
BEGIN
  IF NOT status_writer AND (
       NEW.account_status IS DISTINCT FROM OLD.account_status
    OR NEW.suspended_until IS DISTINCT FROM OLD.suspended_until
    OR NEW.banned_at IS DISTINCT FROM OLD.banned_at
    OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason
    OR NEW.strikes IS DISTINCT FROM OLD.strikes
  ) THEN
    RAISE EXCEPTION 'Account restrictions can only change through enforcement decisions'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.has_role('admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.legal_hold IS DISTINCT FROM OLD.legal_hold THEN
    RAISE EXCEPTION 'legal_hold can only be changed by enforcement workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.account_verification_status IS DISTINCT FROM OLD.account_verification_status THEN
    RAISE EXCEPTION 'account_verification_status can only be changed by verification workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- Keep the old RPC working for any caller, through the writer flag.
CREATE OR REPLACE FUNCTION public.increment_strikes(owner_id_input uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_strikes integer;
BEGIN
  PERFORM set_config('app.account_status_writer', 'recompute', true);
  UPDATE public.account_profiles SET strikes = strikes + 1, updated_at = now()
   WHERE user_id = owner_id_input RETURNING strikes INTO new_strikes;
  PERFORM set_config('app.account_status_writer', '', true);
  RETURN new_strikes;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_strikes_internal(p_user uuid, p_delta integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.account_status_writer', 'recompute', true);
  UPDATE public.account_profiles SET strikes = greatest(strikes + p_delta, 0) WHERE user_id = p_user;
  PERFORM set_config('app.account_status_writer', '', true);
END;
$$;

-- Nothing publishes content for an owner who is banned or suspended.
CREATE OR REPLACE FUNCTION public.block_publish_for_restricted_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status::text = 'live'
     AND (TG_OP = 'INSERT' OR OLD.status::text IS DISTINCT FROM 'live')
     AND EXISTS (SELECT 1 FROM public.account_profiles ap
                  WHERE ap.user_id = NEW.owner_id AND ap.account_status IN ('banned', 'suspended')) THEN
    RAISE EXCEPTION 'The owner of this content is banned or suspended'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_publish_for_restricted_owner ON public.listings;
DROP TRIGGER IF EXISTS block_publish_for_restricted_owner ON public.businesses;
DROP TRIGGER IF EXISTS block_publish_for_restricted_owner ON public.promotions;
CREATE TRIGGER block_publish_for_restricted_owner BEFORE INSERT OR UPDATE OF status ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.block_publish_for_restricted_owner();
CREATE TRIGGER block_publish_for_restricted_owner BEFORE INSERT OR UPDATE OF status ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.block_publish_for_restricted_owner();
CREATE TRIGGER block_publish_for_restricted_owner BEFORE INSERT OR UPDATE OF status ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.block_publish_for_restricted_owner();

-- ── 6. Content effects ──────────────────────────────────────────────────
-- Hide one content row for a decision: live/flagged content is suspended,
-- content waiting for moderation is hidden. Returns true if anything changed.
CREATE OR REPLACE FUNCTION public.apply_content_effect_internal(
  p_decision uuid, p_restriction uuid, p_table text, p_row uuid
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
  v_owner uuid;
  v_target text;
BEGIN
  EXECUTE format('SELECT status::text, owner_id FROM public.%I WHERE id = $1 FOR UPDATE', p_table)
    INTO v_status, v_owner USING p_row;
  v_target := CASE
    WHEN v_status IN ('live', 'flagged_for_review') THEN 'suspended'
    WHEN v_status = 'pending_moderation' THEN 'hidden'
    ELSE NULL
  END;
  IF v_target IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE format('UPDATE public.%I SET status = %L WHERE id = $1', p_table, v_target) USING p_row;
  INSERT INTO public.content_effects (decision_id, restriction_id, table_name, row_id, owner_id,
                                      prior_status, applied_status)
  VALUES (p_decision, p_restriction, p_table, p_row, v_owner, v_status, v_target);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.suspend_owner_content_internal(
  p_decision uuid, p_restriction uuid, p_owner uuid
) RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  t text;
  r record;
  n integer := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY['listings', 'businesses', 'promotions'] LOOP
    FOR r IN EXECUTE format(
      'SELECT id FROM public.%I WHERE owner_id = $1 AND status::text IN (''live'', ''flagged_for_review'', ''pending_moderation'')', t)
      USING p_owner
    LOOP
      IF public.apply_content_effect_internal(p_decision, p_restriction, t, r.id) THEN
        n := n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$$;

-- Revert one effect. Content goes back to its prior status only if nothing
-- else has changed it; live content that can no longer be published (period
-- ended, publication rules refuse) is kept hidden with the reason recorded.
CREATE OR REPLACE FUNCTION public.revert_content_effect_internal(p_effect uuid, p_by_decision uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  e public.content_effects%ROWTYPE;
  v_status text;
  v_expires timestamptz;
  v_end timestamptz;
  v_outcome text;
BEGIN
  SELECT * INTO e FROM public.content_effects WHERE id = p_effect AND reverted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  EXECUTE format('SELECT status::text, (to_jsonb(t)->>''expires_at'')::timestamptz, (to_jsonb(t)->>''end_date'')::timestamptz
                    FROM public.%I t WHERE id = $1 FOR UPDATE', e.table_name)
    INTO v_status, v_expires, v_end USING e.row_id;

  IF v_status IS NULL THEN
    v_outcome := 'skipped:content_deleted';
  ELSIF v_status <> e.applied_status THEN
    v_outcome := 'skipped:status_changed_to_' || v_status;
  ELSIF e.prior_status = 'live' AND (v_expires <= now() OR v_end <= now()) THEN
    BEGIN
      EXECUTE format('UPDATE public.%I SET status = ''hidden'' WHERE id = $1', e.table_name) USING e.row_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    v_outcome := 'kept_hidden:listing_period_ended';
  ELSE
    DECLARE
      v_restore text := CASE WHEN e.prior_status = 'flagged_for_review' THEN 'hidden' ELSE e.prior_status END;
    BEGIN
      EXECUTE format('UPDATE public.%I SET status = %L WHERE id = $1', e.table_name, v_restore) USING e.row_id;
      v_outcome := CASE WHEN v_restore = e.prior_status THEN 'restored' ELSE 'kept_hidden:needs_review' END;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        EXECUTE format('UPDATE public.%I SET status = ''hidden'' WHERE id = $1', e.table_name) USING e.row_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      v_outcome := 'kept_hidden:' || left(SQLERRM, 200);
    END;
  END IF;

  UPDATE public.content_effects
     SET reverted_at = now(), reverted_by_decision_id = p_by_decision, revert_outcome = v_outcome
   WHERE id = e.id;
  RETURN v_outcome;
END;
$$;

-- Lift one restriction. Content hidden because of it is restored only when
-- no other suspension or ban on the owner is still active; otherwise the
-- effects move to the restriction that remains, and are restored when that
-- one is lifted.
CREATE OR REPLACE FUNCTION public.lift_restriction_internal(
  p_restriction uuid, p_by uuid, p_by_decision uuid, p_reason text
) RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  r public.account_restrictions%ROWTYPE;
  v_remaining uuid;
  v_effect record;
  n integer := 0;
BEGIN
  SELECT * INTO r FROM public.account_restrictions WHERE id = p_restriction AND lifted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE public.account_restrictions
     SET lifted_at = now(), lifted_by = p_by, lifted_by_decision_id = p_by_decision, lift_reason = p_reason
   WHERE id = r.id;

  IF r.kind = 'warning' THEN
    PERFORM public.adjust_strikes_internal(r.user_id, -1);
  END IF;

  PERFORM public.recompute_account_status(r.user_id);

  SELECT id INTO v_remaining FROM public.account_restrictions
   WHERE user_id = r.user_id AND kind IN ('suspension', 'ban') AND lifted_at IS NULL
     AND (ends_at IS NULL OR ends_at > now())
   ORDER BY (kind = 'ban') DESC, ends_at DESC NULLS FIRST
   LIMIT 1;

  IF v_remaining IS NOT NULL THEN
    UPDATE public.content_effects SET restriction_id = v_remaining
     WHERE restriction_id = r.id AND reverted_at IS NULL;
    RETURN 0;
  END IF;

  FOR v_effect IN SELECT id FROM public.content_effects WHERE restriction_id = r.id AND reverted_at IS NULL LOOP
    PERFORM public.revert_content_effect_internal(v_effect.id, p_by_decision);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Apply a suspension or ban for a decision, hide the owner's content and
-- recompute the account status. Returns the restriction id.
CREATE OR REPLACE FUNCTION public.impose_restriction_internal(
  p_decision uuid, p_user uuid, p_kind text, p_ends_at timestamptz, p_reason text, p_emergency boolean
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.account_restrictions (decision_id, user_id, kind, reason, ends_at, emergency)
  VALUES (p_decision, p_user, p_kind, p_reason, p_ends_at, coalesce(p_emergency, false))
  RETURNING id INTO v_id;

  IF p_kind = 'warning' THEN
    PERFORM public.adjust_strikes_internal(p_user, 1);
    RETURN v_id;
  END IF;

  PERFORM public.recompute_account_status(p_user);
  PERFORM public.suspend_owner_content_internal(p_decision, v_id, p_user);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_notice_internal(
  p_decision uuid, p_user uuid, p_template text, p_detail jsonb
) RETURNS void
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  SELECT public.enqueue_operation_job(
    'notice:' || p_template || ':' || p_decision::text || ':' || p_user::text,
    'email_notice',
    jsonb_build_object('template', p_template, 'user_id', p_user, 'decision_id', p_decision)
      || coalesce(p_detail, '{}'::jsonb),
    p_decision);
$$;

-- ── 7. Reports: dismiss, warn, hide, propose, emergency ─────────────────
CREATE OR REPLACE FUNCTION public.moderate_report(
  p_actor uuid,
  p_report uuid,
  p_action text,
  p_reason text,
  p_duration_days integer DEFAULT NULL,
  p_emergency boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  rep public.reports%ROWTYPE;
  v_owner uuid;
  v_table text;
  v_decision uuid;
  v_review uuid;
  v_restriction uuid;
  v_hidden boolean;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'No reason given');
BEGIN
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_action NOT IN ('dismiss', 'warn', 'hide', 'suspend', 'ban') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;

  SELECT * INTO rep FROM public.reports WHERE id = p_report FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF rep.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_actioned');
  END IF;

  SELECT o.owner_id, o.table_name INTO v_owner, v_table
    FROM public.report_target_owner(rep.target_type, rep.target_id) o;

  -- Nobody decides a report they filed or one about their own account.
  IF p_actor = rep.reporter_user_id OR p_actor = v_owner THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_independent');
  END IF;

  IF p_action = 'dismiss' THEN
    UPDATE public.reports SET status = 'dismissed', assigned_to = p_actor, resolved_at = now(), updated_at = now()
     WHERE id = p_report;
    INSERT INTO public.moderation_actions (report_id, actor_id, action, target_owner_id, area, reason)
    VALUES (p_report, p_actor, 'dismiss', v_owner, rep.area, v_reason);
    PERFORM public.decision_audit(p_actor, v_role, 'report_resolved', 'report', p_report,
      jsonb_build_object('enforcement_action', 'dismiss'), v_reason);
    RETURN jsonb_build_object('ok', true, 'status', 'dismissed');
  END IF;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'target_missing');
  END IF;

  IF p_action = 'warn' THEN
    INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
      recommendation, rationale, evidence_refs, before_state, payload, approver_id, decided_at, execution_status, executed_at)
    VALUES ('report', p_report::text, 'account_warning', 'approved', p_actor, 'warn', v_reason,
      jsonb_build_array(p_report),
      jsonb_build_object('reportId', p_report, 'ownerId', v_owner),
      jsonb_build_object('report_id', p_report, 'owner_id', v_owner, 'action', 'warn'),
      p_actor, now(), 'succeeded', now())
    RETURNING id INTO v_decision;
    PERFORM public.impose_restriction_internal(v_decision, v_owner, 'warning', NULL, v_reason, false);
    UPDATE public.reports SET status = 'resolved', assigned_to = p_actor, resolved_at = now(), updated_at = now()
     WHERE id = p_report;
    INSERT INTO public.moderation_actions (report_id, actor_id, action, target_owner_id, area, reason)
    VALUES (p_report, p_actor, 'warn', v_owner, rep.area, v_reason);
    PERFORM public.decision_event(v_decision, p_actor, v_role, 'applied', jsonb_build_object('action', 'warn'));
    PERFORM public.decision_audit(p_actor, v_role, 'moderation_action', 'account_profile', v_owner,
      jsonb_build_object('enforcement_action', 'warn', 'decision_id', v_decision, 'report_id', p_report), v_reason);
    PERFORM public.enqueue_notice_internal(v_decision, v_owner, 'account_warn', jsonb_build_object('reason', v_reason));
    RETURN jsonb_build_object('ok', true, 'status', 'applied', 'decision_id', v_decision);
  END IF;

  IF p_action = 'hide' THEN
    IF NOT public.is_decision_staff(v_role) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    IF v_table IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unmappable_hide_target');
    END IF;
    INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
      recommendation, rationale, evidence_refs, before_state, payload, approver_id, decided_at, execution_status, executed_at)
    VALUES ('report', p_report::text, 'content_removal', 'approved', p_actor, 'hide', v_reason,
      jsonb_build_array(p_report),
      jsonb_build_object('reportId', p_report, 'ownerId', v_owner, 'targetType', rep.target_type, 'targetId', rep.target_id),
      jsonb_build_object('report_id', p_report, 'owner_id', v_owner, 'action', 'hide',
                         'table', v_table, 'row_id', rep.target_id),
      p_actor, now(), 'succeeded', now())
    RETURNING id INTO v_decision;
    v_hidden := public.apply_content_effect_internal(v_decision, NULL, v_table, rep.target_id);
    UPDATE public.reports SET status = 'resolved', assigned_to = p_actor, resolved_at = now(), updated_at = now()
     WHERE id = p_report;
    INSERT INTO public.moderation_actions (report_id, actor_id, action, target_owner_id, area, reason)
    VALUES (p_report, p_actor, 'hide', v_owner, rep.area, v_reason);
    PERFORM public.decision_event(v_decision, p_actor, v_role, 'applied',
      jsonb_build_object('action', 'hide', 'content_changed', v_hidden));
    PERFORM public.decision_audit(p_actor, v_role, 'moderation_action', 'report', p_report,
      jsonb_build_object('enforcement_action', 'hide', 'decision_id', v_decision), v_reason);
    PERFORM public.enqueue_notice_internal(v_decision, v_owner, 'content_hidden', jsonb_build_object('reason', v_reason));
    RETURN jsonb_build_object('ok', true, 'status', 'applied', 'decision_id', v_decision, 'content_changed', v_hidden);
  END IF;

  -- Suspensions and bans.
  IF p_action = 'suspend' AND (p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 30) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_duration');
  END IF;

  IF coalesce(p_emergency, false) THEN
    -- Emergency containment: one governor or admin suspends for at most 72
    -- hours. A review decision for the full action is proposed at the same
    -- time; it lapses with the containment unless someone else approves it.
    IF NOT public.is_decision_staff(v_role) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
      recommendation, rationale, evidence_refs, before_state, payload, approver_id, decided_at, execution_status, executed_at)
    VALUES ('report', p_report::text, 'account_suspend', 'approved', p_actor, 'suspend', v_reason,
      jsonb_build_array(p_report),
      jsonb_build_object('reportId', p_report, 'ownerId', v_owner),
      jsonb_build_object('report_id', p_report, 'owner_id', v_owner, 'action', 'suspend', 'emergency', true),
      p_actor, now(), 'succeeded', now())
    RETURNING id INTO v_decision;
    v_restriction := public.impose_restriction_internal(v_decision, v_owner, 'suspension',
      now() + interval '72 hours', v_reason, true);

    INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
      recommendation, rationale, evidence_refs, before_state, payload, payload_version, expires_at, parent_decision_id)
    VALUES ('report', p_report::text,
      CASE WHEN p_action = 'ban' THEN 'account_ban'::public.sensitive_action_category ELSE 'account_suspend' END,
      'pending_approval', p_actor, p_action, v_reason, jsonb_build_array(p_report),
      jsonb_build_object('reportId', p_report, 'ownerId', v_owner),
      jsonb_build_object('report_id', p_report, 'owner_id', v_owner, 'action', p_action,
                         'duration_days', p_duration_days, 'converts_restriction', v_restriction),
      1, now() + interval '72 hours', v_decision)
    RETURNING id INTO v_review;

    UPDATE public.reports SET status = 'in_progress', assigned_to = p_actor, updated_at = now() WHERE id = p_report;
    INSERT INTO public.moderation_actions (report_id, actor_id, action, target_owner_id, area, reason, duration_days)
    VALUES (p_report, p_actor, 'suspend', v_owner, rep.area, v_reason, 3);
    PERFORM public.decision_event(v_decision, p_actor, v_role, 'emergency_applied',
      jsonb_build_object('restriction_id', v_restriction, 'review_decision_id', v_review));
    PERFORM public.decision_event(v_review, p_actor, v_role, 'recommended',
      jsonb_build_object('action', p_action, 'duration_days', p_duration_days));
    PERFORM public.decision_audit(p_actor, v_role, 'account_suspended', 'account_profile', v_owner,
      jsonb_build_object('decision_id', v_decision, 'emergency', true, 'review_decision_id', v_review), v_reason);
    PERFORM public.enqueue_notice_internal(v_decision, v_owner, 'account_suspend',
      jsonb_build_object('reason', v_reason, 'suspended_until', now() + interval '72 hours'));
    RETURN jsonb_build_object('ok', true, 'status', 'emergency_applied', 'decision_id', v_decision,
                              'review_decision_id', v_review);
  END IF;

  -- Ordinary suspensions and bans are proposals for an independent approver.
  INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
    recommendation, rationale, evidence_refs, before_state, payload, payload_version, expires_at)
  VALUES ('report', p_report::text,
    CASE WHEN p_action = 'ban' THEN 'account_ban'::public.sensitive_action_category ELSE 'account_suspend' END,
    'pending_approval', p_actor, p_action, v_reason, jsonb_build_array(p_report),
    jsonb_build_object('reportId', p_report, 'ownerId', v_owner, 'targetType', rep.target_type,
                       'targetId', rep.target_id, 'currentStatus', rep.status),
    jsonb_build_object('report_id', p_report, 'owner_id', v_owner, 'action', p_action,
                       'duration_days', p_duration_days),
    1, now() + interval '7 days')
  RETURNING id INTO v_decision;
  UPDATE public.reports SET status = 'in_progress', assigned_to = p_actor, updated_at = now() WHERE id = p_report;
  PERFORM public.decision_event(v_decision, p_actor, v_role, 'recommended',
    jsonb_build_object('action', p_action, 'duration_days', p_duration_days));
  PERFORM public.decision_audit(p_actor, v_role, 'decision_recommended', 'report', p_report,
    jsonb_build_object('decision_id', v_decision, 'enforcement_action', p_action, 'owner_id', v_owner), v_reason);
  RETURN jsonb_build_object('ok', true, 'status', 'proposed', 'decision_id', v_decision);
END;
$$;

-- ── 8. Approve / reject enforcement and KYC-override decisions ──────────
-- Whether p_actor had any part in the decision (or the decision it reviews).
CREATE OR REPLACE FUNCTION public.decision_involves(p_decision uuid, p_actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.decision_records d
     WHERE d.id IN (p_decision, (SELECT parent_decision_id FROM public.decision_records WHERE id = p_decision))
       AND (d.recommender_id = p_actor OR d.approver_id = p_actor)
  ) OR EXISTS (
    SELECT 1 FROM public.decision_approvals a WHERE a.decision_id = p_decision AND a.approver_id = p_actor
  );
$$;

CREATE OR REPLACE FUNCTION public.approve_decision(
  p_actor uuid, p_decision uuid, p_payload_version integer, p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  d public.decision_records%ROWTYPE;
  v_owner uuid;
  v_report uuid;
  v_reporter uuid;
  v_action text;
  v_restriction uuid;
  v_ends timestamptz;
  v_converts uuid;
  v_kind text;
BEGIN
  SELECT * INTO d FROM public.decision_records WHERE id = p_decision FOR UPDATE;
  IF NOT FOUND OR d.case_type = 'staff_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF d.status NOT IN ('pending_approval', 'escalated') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;
  IF d.expires_at IS NOT NULL AND d.expires_at <= now() THEN
    UPDATE public.decision_records SET status = 'expired', decided_at = now(), updated_at = now() WHERE id = d.id;
    PERFORM public.decision_event(d.id, p_actor, v_role, 'expired', '{}'::jsonb);
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  IF NOT public.is_decision_staff(v_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_owner := coalesce((d.payload->>'owner_id')::uuid, (d.before_state->>'ownerId')::uuid,
                      (d.payload->>'user_id')::uuid);
  v_report := coalesce((d.payload->>'report_id')::uuid, CASE WHEN d.case_type = 'report' THEN d.case_id::uuid END);
  SELECT reporter_user_id INTO v_reporter FROM public.reports WHERE id = v_report;

  IF p_actor = v_owner OR p_actor = v_reporter OR public.decision_involves(d.id, p_actor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_independent');
  END IF;
  IF p_payload_version IS DISTINCT FROM d.payload_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payload_changed');
  END IF;

  INSERT INTO public.decision_approvals (decision_id, approver_id, approver_role, payload_version)
  VALUES (d.id, p_actor, v_role, d.payload_version);

  -- KYC overrides: the verification workflow runs in the application after
  -- this commits and reports back with mark_decision_execution().
  IF d.action_category = 'kyc_override' THEN
    UPDATE public.decision_records
       SET status = 'approved', approver_id = p_actor, approval_rationale = p_note,
           decided_at = now(), updated_at = now(), execution_status = 'pending'
     WHERE id = d.id;
    PERFORM public.decision_event(d.id, p_actor, v_role, 'approved', jsonb_build_object('note', p_note));
    PERFORM public.decision_audit(p_actor, v_role, 'decision_approved', d.case_type, v_owner,
      jsonb_build_object('decision_id', d.id, 'category', d.action_category), p_note);
    RETURN jsonb_build_object('ok', true, 'status', 'approved', 'decision_id', d.id,
                              'execution', 'pending', 'payload', d.payload);
  END IF;

  IF d.action_category NOT IN ('account_ban', 'account_suspend') OR v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_decision');
  END IF;

  v_action := coalesce(d.payload->>'action', d.recommendation);
  v_kind := CASE WHEN v_action = 'ban' OR d.action_category = 'account_ban' THEN 'ban' ELSE 'suspension' END;
  v_ends := CASE WHEN v_kind = 'suspension'
                 THEN now() + make_interval(days => greatest(1, least(30, coalesce((d.payload->>'duration_days')::integer, 7))))
                 END;

  v_restriction := public.impose_restriction_internal(d.id, v_owner, v_kind, v_ends, d.rationale, false);

  -- Approving an emergency review replaces the 72-hour containment: its
  -- hidden content moves to the new restriction before it is lifted.
  v_converts := (d.payload->>'converts_restriction')::uuid;
  IF v_converts IS NOT NULL THEN
    UPDATE public.content_effects SET restriction_id = v_restriction
     WHERE restriction_id = v_converts AND reverted_at IS NULL;
    PERFORM public.lift_restriction_internal(v_converts, p_actor, d.id, 'Replaced by the approved decision');
  END IF;

  UPDATE public.decision_records
     SET status = 'approved', approver_id = p_actor, approval_rationale = p_note,
         after_state = jsonb_build_object('restriction_id', v_restriction, 'kind', v_kind, 'ends_at', v_ends),
         decided_at = now(), updated_at = now(), execution_status = 'succeeded', executed_at = now()
   WHERE id = d.id;

  IF v_report IS NOT NULL THEN
    UPDATE public.reports SET status = 'resolved', resolved_at = now(), updated_at = now() WHERE id = v_report;
  END IF;
  INSERT INTO public.moderation_actions (report_id, actor_id, action, target_owner_id, area, reason, duration_days)
  SELECT v_report, p_actor, (CASE WHEN v_kind = 'ban' THEN 'ban' ELSE 'suspend' END)::public.enforcement_action,
         v_owner, coalesce((SELECT area FROM public.reports WHERE id = v_report), 'MZANSI_MARKET'),
         d.rationale, (d.payload->>'duration_days')::integer;

  PERFORM public.decision_event(d.id, p_actor, v_role, 'approved',
    jsonb_build_object('note', p_note, 'restriction_id', v_restriction));
  PERFORM public.decision_audit(p_actor, v_role,
    CASE WHEN v_kind = 'ban' THEN 'account_banned' ELSE 'account_suspended' END,
    'account_profile', v_owner, jsonb_build_object('decision_id', d.id, 'report_id', v_report), d.rationale);
  PERFORM public.enqueue_notice_internal(d.id, v_owner,
    CASE WHEN v_kind = 'ban' THEN 'account_ban' ELSE 'account_suspend' END,
    jsonb_build_object('reason', d.rationale, 'suspended_until', v_ends));

  RETURN jsonb_build_object('ok', true, 'status', 'applied', 'decision_id', d.id, 'restriction_id', v_restriction);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_decision(p_actor uuid, p_decision uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  d public.decision_records%ROWTYPE;
  v_withdraw boolean;
  v_converts uuid;
  v_report uuid;
BEGIN
  SELECT * INTO d FROM public.decision_records WHERE id = p_decision FOR UPDATE;
  IF NOT FOUND OR d.case_type = 'staff_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF d.status NOT IN ('pending_approval', 'escalated') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  v_withdraw := p_actor = d.recommender_id;
  IF NOT v_withdraw AND NOT public.is_decision_staff(v_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.decision_records
     SET status = CASE WHEN v_withdraw THEN 'cancelled'::public.decision_status ELSE 'rejected' END,
         approver_id = CASE WHEN v_withdraw THEN approver_id ELSE p_actor END,
         approval_rationale = p_note, decided_at = now(), updated_at = now()
   WHERE id = d.id;

  -- Rejecting an emergency review ends the containment now.
  v_converts := (d.payload->>'converts_restriction')::uuid;
  IF v_converts IS NOT NULL THEN
    PERFORM public.lift_restriction_internal(v_converts, p_actor, d.id, 'Emergency review rejected');
  END IF;

  -- The report goes back to the queue for another outcome.
  v_report := (d.payload->>'report_id')::uuid;
  IF v_report IS NOT NULL THEN
    UPDATE public.reports SET status = 'open', assigned_to = NULL, updated_at = now()
     WHERE id = v_report AND status = 'in_progress';
  END IF;

  PERFORM public.decision_event(d.id, p_actor, v_role, CASE WHEN v_withdraw THEN 'withdrawn' ELSE 'rejected' END,
    jsonb_build_object('note', p_note));
  PERFORM public.decision_audit(p_actor, v_role, 'decision_rejected', d.case_type,
    coalesce((d.payload->>'owner_id')::uuid, v_report),
    jsonb_build_object('decision_id', d.id, 'withdrawn', v_withdraw), p_note);
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_withdraw THEN 'withdrawn' ELSE 'rejected' END);
END;
$$;

-- A high- or critical-risk KYC approval is an override that someone other
-- than the proposer approves (approve_decision marks it for execution).
CREATE OR REPLACE FUNCTION public.propose_kyc_override(
  p_actor uuid, p_step uuid, p_user uuid, p_risk_level text, p_override_reason text, p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  v_decision uuid;
BEGIN
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_actor = p_user THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_independent');
  END IF;
  IF length(btrim(coalesce(p_override_reason, ''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;
  IF EXISTS (SELECT 1 FROM public.decision_records
              WHERE case_type = 'verification_step' AND case_id = p_step::text
                AND status IN ('pending_approval', 'escalated')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pending_exists');
  END IF;

  INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
    recommendation, rationale, evidence_refs, before_state, payload, payload_version, expires_at)
  VALUES ('verification_step', p_step::text, 'kyc_override', 'pending_approval', p_actor, 'approve',
    coalesce(nullif(btrim(p_note), ''), p_override_reason), jsonb_build_array(p_step),
    jsonb_build_object('stepId', p_step, 'ownerId', p_user, 'riskLevel', p_risk_level),
    jsonb_build_object('step_id', p_step, 'user_id', p_user, 'override_reason_code', p_override_reason,
                       'risk_level', p_risk_level),
    1, now() + interval '7 days')
  RETURNING id INTO v_decision;

  PERFORM public.decision_event(v_decision, p_actor, v_role, 'recommended',
    jsonb_build_object('override_reason_code', p_override_reason));
  PERFORM public.decision_audit(p_actor, v_role, 'decision_recommended', 'verification_step', p_step,
    jsonb_build_object('decision_id', v_decision, 'category', 'kyc_override', 'risk_level', p_risk_level),
    p_note);
  RETURN jsonb_build_object('ok', true, 'status', 'proposed', 'decision_id', v_decision);
END;
$$;

-- Record the outcome of work done in the application for an approved
-- decision (KYC overrides). Idempotent; a retry may report success later.
CREATE OR REPLACE FUNCTION public.mark_decision_execution(p_decision uuid, p_ok boolean, p_error text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.decision_records
     SET execution_status = CASE WHEN p_ok THEN 'succeeded' ELSE 'failed' END,
         execution_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END,
         executed_at = CASE WHEN p_ok THEN now() ELSE executed_at END,
         updated_at = now()
   WHERE id = p_decision AND status = 'approved' AND execution_status IN ('pending', 'failed');
  IF NOT p_ok THEN
    PERFORM public.record_ops_event('decision_execution_failed', 'critical',
      jsonb_build_object('decision_id', p_decision, 'error', left(p_error, 500)));
  END IF;
END;
$$;

-- ── 9. Lift a restriction outside an appeal ─────────────────────────────
CREATE OR REPLACE FUNCTION public.lift_restriction(p_actor uuid, p_restriction uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  r public.account_restrictions%ROWTYPE;
  v_decision uuid;
BEGIN
  IF NOT public.is_decision_staff(v_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;
  SELECT * INTO r FROM public.account_restrictions WHERE id = p_restriction FOR UPDATE;
  IF NOT FOUND OR r.lifted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_active');
  END IF;
  IF p_actor = r.user_id OR public.decision_involves(r.decision_id, p_actor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_independent');
  END IF;

  INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
    recommendation, rationale, before_state, payload, approver_id, decided_at, parent_decision_id,
    execution_status, executed_at)
  VALUES ('restriction', r.id::text,
    CASE r.kind WHEN 'ban' THEN 'account_ban'::public.sensitive_action_category
                WHEN 'suspension' THEN 'account_suspend' ELSE 'account_warning' END,
    'approved', p_actor, 'lift', p_reason,
    jsonb_build_object('restriction_id', r.id, 'kind', r.kind),
    jsonb_build_object('owner_id', r.user_id, 'action', 'lift', 'restriction_id', r.id),
    p_actor, now(), r.decision_id, 'succeeded', now())
  RETURNING id INTO v_decision;

  PERFORM public.lift_restriction_internal(r.id, p_actor, v_decision, p_reason);
  INSERT INTO public.moderation_actions (actor_id, action, target_owner_id, area, reason)
  VALUES (p_actor, 'lift', r.user_id, 'MZANSI_MARKET', p_reason);
  PERFORM public.decision_event(v_decision, p_actor, v_role, 'applied', jsonb_build_object('restriction_id', r.id));
  PERFORM public.decision_audit(p_actor, v_role,
    CASE r.kind WHEN 'ban' THEN 'account_unbanned' WHEN 'suspension' THEN 'account_unsuspended' ELSE 'moderation_action' END,
    'account_profile', r.user_id, jsonb_build_object('decision_id', v_decision, 'restriction_id', r.id), p_reason);
  PERFORM public.enqueue_notice_internal(v_decision, r.user_id, 'restriction_lifted', jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'status', 'lifted', 'decision_id', v_decision);
END;
$$;

-- ── 10. Appeals ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_appeal(
  p_user uuid, p_decision uuid, p_reason text, p_evidence jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  d public.decision_records%ROWTYPE;
  v_affected boolean;
  v_appeal uuid;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 20 OR length(p_reason) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_length');
  END IF;
  IF jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_evidence, '[]'::jsonb)) > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_much_evidence');
  END IF;

  SELECT * INTO d FROM public.decision_records WHERE id = p_decision FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Only the person the decision affects may appeal it.
  v_affected := (d.payload->>'owner_id')::uuid = p_user
    OR EXISTS (SELECT 1 FROM public.account_restrictions WHERE decision_id = d.id AND user_id = p_user)
    OR EXISTS (SELECT 1 FROM public.content_effects WHERE decision_id = d.id AND owner_id = p_user);
  IF NOT coalesce(v_affected, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF d.status <> 'approved'
     OR d.action_category NOT IN ('account_ban', 'account_suspend', 'account_warning', 'content_removal')
     OR d.recommendation = 'lift' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_appealable');
  END IF;
  IF EXISTS (SELECT 1 FROM public.appeal_cases WHERE decision_id = d.id AND status IN ('submitted', 'under_review')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'appeal_open');
  END IF;
  IF EXISTS (SELECT 1 FROM public.appeal_cases WHERE decision_id = d.id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_appealed');
  END IF;

  INSERT INTO public.appeal_cases (decision_id, appellant_id, reason, evidence_refs)
  VALUES (d.id, p_user, btrim(p_reason), coalesce(p_evidence, '[]'::jsonb))
  RETURNING id INTO v_appeal;

  PERFORM public.decision_event(d.id, p_user, 'member', 'appealed', jsonb_build_object('appeal_id', v_appeal));
  PERFORM public.decision_audit(p_user, 'member', 'appeal_submitted', 'decision', d.id,
    jsonb_build_object('appeal_id', v_appeal), NULL);
  RETURN jsonb_build_object('ok', true, 'status', 'submitted', 'appeal_id', v_appeal);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_appeal(
  p_actor uuid, p_appeal uuid, p_outcome text, p_rationale text, p_shorten_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  a public.appeal_cases%ROWTYPE;
  d public.decision_records%ROWTYPE;
  r record;
  e record;
  v_owner uuid;
  v_lifted integer := 0;
BEGIN
  IF NOT public.is_decision_staff(v_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_outcome NOT IN ('upheld', 'overturned', 'partially_overturned', 'dismissed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_outcome');
  END IF;
  IF length(btrim(coalesce(p_rationale, ''))) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;

  SELECT * INTO a FROM public.appeal_cases WHERE id = p_appeal FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF a.status NOT IN ('submitted', 'under_review') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;
  SELECT * INTO d FROM public.decision_records WHERE id = a.decision_id FOR UPDATE;
  v_owner := coalesce((d.payload->>'owner_id')::uuid, a.appellant_id);

  -- The reviewer must not have taken part in the decision being appealed.
  IF p_actor = a.appellant_id OR public.decision_involves(d.id, p_actor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_independent');
  END IF;

  IF p_outcome = 'overturned' THEN
    FOR r IN SELECT id FROM public.account_restrictions WHERE decision_id = d.id AND lifted_at IS NULL LOOP
      PERFORM public.lift_restriction_internal(r.id, p_actor, d.id, 'Appeal overturned');
      v_lifted := v_lifted + 1;
    END LOOP;
    -- Content hidden directly by the decision (not through a restriction).
    FOR e IN SELECT id FROM public.content_effects
              WHERE decision_id = d.id AND restriction_id IS NULL AND reverted_at IS NULL LOOP
      PERFORM public.revert_content_effect_internal(e.id, d.id);
    END LOOP;
    UPDATE public.decision_records SET status = 'overridden', updated_at = now() WHERE id = d.id;
  ELSIF p_outcome = 'partially_overturned' THEN
    IF p_shorten_to IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'shorten_to_required');
    END IF;
    FOR r IN SELECT id, kind, ends_at FROM public.account_restrictions
              WHERE decision_id = d.id AND lifted_at IS NULL AND kind = 'suspension' LOOP
      IF p_shorten_to <= now() THEN
        PERFORM public.lift_restriction_internal(r.id, p_actor, d.id, 'Appeal partially overturned');
      ELSIF r.ends_at IS NULL OR p_shorten_to < r.ends_at THEN
        UPDATE public.account_restrictions SET ends_at = p_shorten_to WHERE id = r.id;
        PERFORM public.recompute_account_status(v_owner);
      END IF;
      v_lifted := v_lifted + 1;
    END LOOP;
    IF v_lifted = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_shorten');
    END IF;
  END IF;

  UPDATE public.appeal_cases
     SET status = p_outcome::public.appeal_status, reviewer_id = p_actor, reviewer_rationale = p_rationale,
         outcome_detail = jsonb_build_object('shorten_to', p_shorten_to, 'restrictions_changed', v_lifted),
         resolved_at = now(), updated_at = now()
   WHERE id = a.id;

  PERFORM public.decision_event(d.id, p_actor, v_role, 'appeal_' || p_outcome,
    jsonb_build_object('appeal_id', a.id, 'restrictions_changed', v_lifted));
  PERFORM public.decision_audit(p_actor, v_role,
    CASE WHEN p_outcome IN ('upheld', 'dismissed') THEN 'appeal_upheld' ELSE 'appeal_overturned' END,
    'appeal', a.id, jsonb_build_object('outcome', p_outcome, 'decision_id', d.id), p_rationale);
  INSERT INTO public.notifications (user_id, type, title, message, href)
  VALUES (a.appellant_id,
          CASE WHEN p_outcome IN ('overturned', 'partially_overturned') THEN 'success' ELSE 'info' END,
          'Your appeal has been decided',
          CASE p_outcome
            WHEN 'overturned' THEN 'The decision was reversed.'
            WHEN 'partially_overturned' THEN 'The decision was reduced.'
            ELSE 'The decision stands.' END,
          '/appeals/' || a.id::text);
  PERFORM public.enqueue_notice_internal(d.id, a.appellant_id, 'appeal_' || p_outcome,
    jsonb_build_object('appeal_id', a.id, 'rationale', p_rationale));
  RETURN jsonb_build_object('ok', true, 'status', p_outcome, 'restrictions_changed', v_lifted);
END;
$$;

-- ── 11. Operation jobs ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_operation_jobs(p_limit integer)
RETURNS SETOF public.operation_jobs
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  UPDATE public.operation_jobs j
     SET status = 'running', attempts = j.attempts + 1, locked_until = now() + interval '5 minutes',
         updated_at = now()
   WHERE j.id IN (
     SELECT id FROM public.operation_jobs
      WHERE (status = 'pending' AND next_run_at <= now())
         OR (status = 'running' AND locked_until < now())
      ORDER BY next_run_at
      LIMIT greatest(1, least(p_limit, 50))
      FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
$$;

CREATE OR REPLACE FUNCTION public.complete_operation_job(p_job uuid, p_ok boolean, p_error text)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  j public.operation_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.operation_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.status <> 'running' THEN
    RETURN NULL;
  END IF;
  IF p_ok THEN
    UPDATE public.operation_jobs SET status = 'succeeded', completed_at = now(), locked_until = NULL,
           last_error = NULL, updated_at = now() WHERE id = j.id;
    RETURN 'succeeded';
  END IF;
  IF j.attempts >= j.max_attempts THEN
    UPDATE public.operation_jobs SET status = 'dead', locked_until = NULL, last_error = left(p_error, 500),
           updated_at = now() WHERE id = j.id;
    PERFORM public.record_ops_event('operation_job_dead', 'critical',
      jsonb_build_object('job_id', j.id, 'kind', j.kind, 'decision_id', j.decision_id, 'error', left(p_error, 500)));
    RETURN 'dead';
  END IF;
  UPDATE public.operation_jobs
     SET status = 'pending', locked_until = NULL, last_error = left(p_error, 500),
         next_run_at = now() + make_interval(mins => (2 ^ least(j.attempts, 8))::integer), updated_at = now()
   WHERE id = j.id;
  RETURN 'retrying';
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_operation_job(p_actor uuid, p_job uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  UPDATE public.operation_jobs
     SET status = 'pending', attempts = 0, next_run_at = now(), locked_until = NULL, updated_at = now()
   WHERE id = p_job AND status = 'dead';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_dead');
  END IF;
  PERFORM public.decision_audit(p_actor, v_role, 'operation_job_retried', 'operation_job', p_job, '{}'::jsonb, NULL);
  RETURN jsonb_build_object('ok', true, 'status', 'pending');
END;
$$;

-- ── 12. Scheduled expiry ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_due_items()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  r record;
  v_lifted integer := 0;
  v_expired integer := 0;
BEGIN
  FOR r IN
    SELECT id, user_id, emergency FROM public.account_restrictions
     WHERE lifted_at IS NULL AND ends_at IS NOT NULL AND ends_at <= now()
     ORDER BY ends_at
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.lift_restriction_internal(r.id, NULL, NULL,
      CASE WHEN r.emergency THEN 'Emergency containment lapsed' ELSE 'Period ended' END);
    PERFORM public.decision_audit(NULL, 'system',
      CASE WHEN r.emergency THEN 'emergency_containment_lapsed' ELSE 'account_unsuspended' END,
      'account_profile', r.user_id, jsonb_build_object('restriction_id', r.id), NULL);
    v_lifted := v_lifted + 1;
  END LOOP;

  FOR r IN
    SELECT id, payload FROM public.decision_records
     WHERE status = 'pending_approval' AND expires_at IS NOT NULL AND expires_at <= now()
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.decision_records SET status = 'expired', decided_at = now(), updated_at = now() WHERE id = r.id;
    PERFORM public.decision_event(r.id, NULL, 'system', 'expired', '{}'::jsonb);
    UPDATE public.reports SET status = 'open', assigned_to = NULL, updated_at = now()
     WHERE id = (r.payload->>'report_id')::uuid AND status = 'in_progress';
    v_expired := v_expired + 1;
  END LOOP;

  INSERT INTO public.ops_heartbeats (name, last_run_at, detail)
  VALUES ('expire_due_items', now(), jsonb_build_object('lifted', v_lifted, 'expired', v_expired))
  ON CONFLICT (name) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, detail = EXCLUDED.detail;

  RETURN jsonb_build_object('lifted', v_lifted, 'expired', v_expired);
END;
$$;

DROP FUNCTION IF EXISTS public.lift_expired_suspensions();

-- ── 13. Legacy backfill ─────────────────────────────────────────────────
-- Accounts banned or suspended before this migration get a decision and a
-- restriction so they can be appealed and lifted precisely. Nothing is
-- invented: the decision is marked legacy_backfill with no recommender, and
-- content hidden before now is not linked (it has no recorded effect).
DO $$
DECLARE
  p record;
  v_decision uuid;
BEGIN
  FOR p IN
    SELECT user_id, account_status::text AS status, suspended_until, banned_at, ban_reason
      FROM public.account_profiles
     WHERE account_status IN ('banned', 'suspended')
  LOOP
    INSERT INTO public.decision_records (case_type, case_id, action_category, status, recommender_id,
      recommendation, rationale, before_state, payload, decided_at, execution_status, executed_at)
    VALUES ('legacy_enforcement', p.user_id::text,
      CASE WHEN p.status = 'banned' THEN 'account_ban'::public.sensitive_action_category ELSE 'account_suspend' END,
      'approved', NULL, CASE WHEN p.status = 'banned' THEN 'ban' ELSE 'suspend' END,
      coalesce(p.ban_reason, 'Recorded before the decision ledger'),
      jsonb_build_object('ownerId', p.user_id),
      jsonb_build_object('owner_id', p.user_id, 'legacy_backfill', true),
      coalesce(p.banned_at, now()), 'succeeded', now())
    RETURNING id INTO v_decision;

    INSERT INTO public.account_restrictions (decision_id, user_id, kind, reason, starts_at, ends_at)
    VALUES (v_decision, p.user_id, CASE WHEN p.status = 'banned' THEN 'ban' ELSE 'suspension' END,
            coalesce(p.ban_reason, 'Recorded before the decision ledger'),
            coalesce(p.banned_at, now()), CASE WHEN p.status = 'suspended' THEN p.suspended_until END);

    INSERT INTO public.decision_record_events (decision_id, actor_id, actor_role, event_type, detail)
    VALUES (v_decision, NULL, 'system', 'legacy_backfill', jsonb_build_object('account_status', p.status));
  END LOOP;
END $$;

-- ── 14. Append-only audit tables ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.audit_redaction', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'audit_logs'
     AND current_setting('app.audit_retention', true) = 'on'
     AND OLD.created_at < now() - interval '24 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_audit_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs', 'decision_record_events', 'role_assignments_history'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation()', t || '_append_only', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_truncate()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- The 24-month retention purge, the only delete path for audit_logs.
CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs()
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  n integer;
BEGIN
  PERFORM set_config('app.audit_retention', 'on', true);
  DELETE FROM public.audit_logs a
   WHERE a.created_at < now() - interval '24 months'
     AND NOT EXISTS (SELECT 1 FROM public.account_profiles ap WHERE ap.user_id = a.actor_id AND ap.legal_hold = true);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.audit_retention', '', true);
  RETURN n;
END;
$$;

-- POPIA: remove personal details from the audit trail of a deleted account.
-- Rows stay (pseudonymous ids, actions, dates); personal fields in metadata
-- are removed and the redaction itself is audited.
CREATE OR REPLACE FUNCTION public.redact_personal_audit_data(p_user uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  n integer;
  personal constant text[] := ARRAY['email', 'phone', 'name', 'full_name', 'display_name', 'ip', 'ip_address',
                                    'user_agent', 'requester_email', 'requester_phone', 'address'];
BEGIN
  PERFORM set_config('app.audit_redaction', 'on', true);
  UPDATE public.audit_logs
     SET metadata = metadata - personal
   WHERE (actor_id = p_user OR target_id = p_user) AND metadata ?| personal;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.audit_redaction', '', true);
  PERFORM public.decision_audit(NULL, 'system', 'audit_redacted', 'user', p_user,
    jsonb_build_object('rows', n), p_reason);
  RETURN n;
END;
$$;

-- ── 15. Grants ──────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.record_ops_event(text, text, jsonb)',
    'public.enqueue_operation_job(text, text, jsonb, uuid)',
    'public.is_decision_staff(text)',
    'public.decision_event(uuid, uuid, text, text, jsonb)',
    'public.decision_audit(uuid, text, text, text, uuid, jsonb, text)',
    'public.report_target_owner(text, uuid)',
    'public.recompute_account_status(uuid)',
    'public.adjust_strikes_internal(uuid, integer)',
    'public.apply_content_effect_internal(uuid, uuid, text, uuid)',
    'public.suspend_owner_content_internal(uuid, uuid, uuid)',
    'public.revert_content_effect_internal(uuid, uuid)',
    'public.lift_restriction_internal(uuid, uuid, uuid, text)',
    'public.impose_restriction_internal(uuid, uuid, text, timestamptz, text, boolean)',
    'public.enqueue_notice_internal(uuid, uuid, text, jsonb)',
    'public.moderate_report(uuid, uuid, text, text, integer, boolean)',
    'public.decision_involves(uuid, uuid)',
    'public.approve_decision(uuid, uuid, integer, text)',
    'public.reject_decision(uuid, uuid, text)',
    'public.mark_decision_execution(uuid, boolean, text)',
    'public.propose_kyc_override(uuid, uuid, uuid, text, text, text)',
    'public.lift_restriction(uuid, uuid, text)',
    'public.submit_appeal(uuid, uuid, text, jsonb)',
    'public.resolve_appeal(uuid, uuid, text, text, timestamptz)',
    'public.claim_operation_jobs(integer)',
    'public.complete_operation_job(uuid, boolean, text)',
    'public.retry_operation_job(uuid, uuid)',
    'public.expire_due_items()',
    'public.purge_expired_audit_logs()',
    'public.redact_personal_audit_data(uuid, text)',
    'public.prevent_audit_mutation()',
    'public.prevent_audit_truncate()',
    'public.block_publish_for_restricted_owner()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ── 16. Schedules ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lift-expired-suspensions') THEN
      PERFORM cron.unschedule('lift-expired-suspensions');
    END IF;
    PERFORM cron.schedule('expire-due-items', '*/5 * * * *', 'SELECT public.expire_due_items()');
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_audit_logs_24mo') THEN
      PERFORM cron.alter_job(
        (SELECT jobid FROM cron.job WHERE jobname = 'retention_audit_logs_24mo'),
        command := 'SELECT public.purge_expired_audit_logs()');
    END IF;
  END IF;
END $$;

COMMIT;
