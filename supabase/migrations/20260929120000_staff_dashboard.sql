-- Staff home and navigation counts in one call each.
--
-- staff_nav_counts(actor): the sidebar badges, on every admin page.
-- staff_dashboard(actor):  the role home at /admin.
--
-- Both are scoped to the actor's role from staff_roles, re-checked here. A
-- key that is missing means "not for your role"; a key that is null means
-- "could not be read", which the page shows as "Unavailable", never as 0.
-- Each section is read in its own exception block so one failure does not
-- blank the whole page.
--
-- Definitions (the cards show these, nothing else):
--   reports.open        reports with status 'open'
--   reports.breached    open reports past their SLA: high 4 hours, standard
--                       24 hours (mirrors src/lib/utils/sla.ts)
--   kyc.pending         verification steps 'pending', excluding location
--                       (the queue moderators claim from)
--   content.pending     listings, businesses and promotions in
--                       'pending_moderation', plus pending content edits
--   support.new         contact submissions with status 'new'
--   *.claimed           items in that queue with a live claim
--   *.oldest_at         when the oldest waiting item arrived
--   shift.actions_today audit events by the actor since midnight,
--                       Africa/Johannesburg time
--   decisions.*         open ledger decisions, excluding staff role changes,
--                       which are counted separately
--   restrictions.*      restrictions not lifted and not past their end
--   dsar.*              open data requests by the deadline that applies now
--   oversight.*         the last 30 days, each with its denominator

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_nav_counts(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  v jsonb;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v := jsonb_build_object(
    'reports', (SELECT count(*) FROM public.reports WHERE status = 'open'),
    'kyc', (SELECT count(*) FROM public.verification_steps
             WHERE status = 'pending' AND step_type::text <> 'location'),
    'content', (SELECT count(*) FROM public.listings WHERE status = 'pending_moderation')
             + (SELECT count(*) FROM public.businesses WHERE status = 'pending_moderation')
             + (SELECT count(*) FROM public.promotions WHERE status = 'pending_moderation')
             + (SELECT count(*) FROM public.content_edit_requests WHERE status = 'pending'),
    'support', (SELECT count(*) FROM public.contact_submissions WHERE status = 'new'));

  IF public.is_decision_staff(v_role) THEN
    v := v || jsonb_build_object(
      'decisions', (SELECT count(*) FROM public.decision_records
                     WHERE status IN ('pending_approval', 'escalated') AND case_type <> 'staff_role'),
      'appeals', (SELECT count(*) FROM public.appeal_cases WHERE status IN ('submitted', 'under_review')),
      'dsar_overdue', (SELECT count(*) FROM public.dsar_cases
                        WHERE status IN ('submitted', 'identity_pending', 'in_progress')
                          AND effective_due_at < now()),
      'role_changes', (SELECT count(*) FROM public.decision_records
                        WHERE case_type = 'staff_role' AND status = 'pending_approval'));
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_dashboard(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  v_today timestamptz := date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg')
                         AT TIME ZONE 'Africa/Johannesburg';
  v_window timestamptz := now() - interval '30 days';
  v_open_dsar public.dsar_status[] := ARRAY['submitted', 'identity_pending', 'in_progress']::public.dsar_status[];
  v_out jsonb;
  v_queues jsonb := '{}'::jsonb;
  v_section jsonb;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_out := jsonb_build_object('role', v_role, 'generated_at', now());

  -- ── Queues: every staff role ──────────────────────────────────────────
  BEGIN
    SELECT jsonb_build_object(
             'open', count(*),
             'oldest_at', min(created_at),
             'breached', count(*) FILTER (
               WHERE created_at < now() - CASE WHEN severity::text = 'high'
                                               THEN interval '4 hours' ELSE interval '24 hours' END),
             'claimed', (SELECT count(*) FROM public.queue_claims
                          WHERE queue = 'reports' AND expires_at > now()))
      INTO v_section FROM public.reports WHERE status = 'open';
    v_queues := v_queues || jsonb_build_object('reports', v_section);
  EXCEPTION WHEN OTHERS THEN
    v_queues := v_queues || jsonb_build_object('reports', NULL);
  END;

  BEGIN
    SELECT jsonb_build_object(
             'pending', count(*),
             'oldest_at', min(created_at),
             'high_risk', count(*) FILTER (WHERE risk_level IN ('high', 'critical')),
             'claimed', (SELECT count(*) FROM public.queue_claims
                          WHERE queue = 'kyc' AND expires_at > now()))
      INTO v_section FROM public.verification_steps
     WHERE status = 'pending' AND step_type::text <> 'location';
    v_queues := v_queues || jsonb_build_object('kyc', v_section);
  EXCEPTION WHEN OTHERS THEN
    v_queues := v_queues || jsonb_build_object('kyc', NULL);
  END;

  BEGIN
    WITH waiting AS (
      SELECT created_at FROM public.listings WHERE status = 'pending_moderation'
      UNION ALL SELECT created_at FROM public.businesses WHERE status = 'pending_moderation'
      UNION ALL SELECT created_at FROM public.promotions WHERE status = 'pending_moderation'
      UNION ALL SELECT created_at FROM public.content_edit_requests WHERE status = 'pending'
    )
    SELECT jsonb_build_object(
             'pending', count(*),
             'oldest_at', min(created_at),
             'claimed', (SELECT count(*) FROM public.queue_claims
                          WHERE queue = 'content' AND expires_at > now()))
      INTO v_section FROM waiting;
    v_queues := v_queues || jsonb_build_object('content', v_section);
  EXCEPTION WHEN OTHERS THEN
    v_queues := v_queues || jsonb_build_object('content', NULL);
  END;

  BEGIN
    SELECT jsonb_build_object('new', count(*), 'oldest_at', min(created_at))
      INTO v_section FROM public.contact_submissions WHERE status = 'new';
    v_queues := v_queues || jsonb_build_object('support', v_section);
  EXCEPTION WHEN OTHERS THEN
    v_queues := v_queues || jsonb_build_object('support', NULL);
  END;
  v_out := v_out || jsonb_build_object('queues', v_queues);

  -- ── My shift: people who claim queue work (moderators, admins) ────────
  IF v_role IN ('moderator', 'admin') THEN
    BEGIN
      SELECT jsonb_build_object(
               'claims', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'item_type', item_type, 'item_id', item_id, 'queue', queue,
                          'expires_at', expires_at, 'renewals', renewals)
                        ORDER BY expires_at)
                   FROM public.queue_claims
                  WHERE claimed_by = p_actor AND expires_at > now()), '[]'::jsonb),
               'escalations_open', (SELECT count(*) FROM public.decision_records
                                     WHERE recommender_id = p_actor
                                       AND status IN ('pending_approval', 'escalated')),
               'actions_today', (SELECT count(*) FROM public.audit_logs
                                  WHERE actor_id = p_actor AND created_at >= v_today))
        INTO v_section;
      v_out := v_out || jsonb_build_object('shift', v_section);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('shift', NULL);
    END;
  END IF;

  -- ── Decisions and oversight: governors and admins ─────────────────────
  IF public.is_decision_staff(v_role) THEN
    BEGIN
      SELECT jsonb_build_object(
               'escalated', count(*) FILTER (WHERE status = 'escalated'),
               'pending_approval', count(*) FILTER (WHERE status = 'pending_approval'),
               'expiring_24h', count(*) FILTER (WHERE status = 'pending_approval'
                                                  AND expires_at < now() + interval '24 hours'),
               'oldest_at', min(created_at),
               'failed_executions', (SELECT count(*) FROM public.decision_records
                                      WHERE execution_status = 'failed'),
               'role_changes_pending', (SELECT count(*) FROM public.decision_records
                                         WHERE case_type = 'staff_role' AND status = 'pending_approval'),
               'appeals_open', (SELECT count(*) FROM public.appeal_cases
                                 WHERE status IN ('submitted', 'under_review')),
               'appeals_oldest_at', (SELECT min(created_at) FROM public.appeal_cases
                                      WHERE status IN ('submitted', 'under_review')))
        INTO v_section
        FROM public.decision_records
       WHERE status IN ('pending_approval', 'escalated') AND case_type <> 'staff_role';
      v_out := v_out || jsonb_build_object('decisions', v_section);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('decisions', NULL);
    END;

    BEGIN
      SELECT jsonb_build_object(
               'suspensions', count(*) FILTER (WHERE kind = 'suspension'),
               'bans', count(*) FILTER (WHERE kind = 'ban'),
               'emergency', count(*) FILTER (WHERE emergency))
        INTO v_section
        FROM public.account_restrictions
       WHERE lifted_at IS NULL AND kind IN ('suspension', 'ban')
         AND (ends_at IS NULL OR ends_at > now());
      v_out := v_out || jsonb_build_object('restrictions', v_section);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('restrictions', NULL);
    END;

    BEGIN
      SELECT jsonb_build_object(
               'open', count(*),
               'overdue', count(*) FILTER (WHERE effective_due_at < now()),
               'due_7d', count(*) FILTER (WHERE effective_due_at >= now()
                                            AND effective_due_at < now() + interval '7 days'),
               'unassigned', count(*) FILTER (WHERE assigned_to IS NULL),
               'next_due_at', min(effective_due_at) FILTER (WHERE effective_due_at >= now()))
        INTO v_section
        FROM public.dsar_cases WHERE status = ANY (v_open_dsar);
      v_out := v_out || jsonb_build_object('dsar', v_section);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('dsar', NULL);
    END;

    BEGIN
      SELECT jsonb_build_object(
               'window_days', 30,
               'appeals_resolved', (SELECT count(*) FROM public.appeal_cases
                                     WHERE resolved_at >= v_window),
               'appeals_overturned', (SELECT count(*) FROM public.appeal_cases
                                       WHERE resolved_at >= v_window
                                         AND status IN ('overturned', 'partially_overturned')),
               'decisions_made', (SELECT count(*) FROM public.decision_records
                                   WHERE decided_at >= v_window AND case_type <> 'staff_role'
                                     AND status IN ('approved', 'rejected', 'overridden')),
               'escalations', (SELECT count(*) FROM public.decision_record_events
                                WHERE event_type = 'escalated' AND created_at >= v_window))
        INTO v_section;
      v_out := v_out || jsonb_build_object('oversight', v_section);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('oversight', NULL);
    END;
  END IF;

  -- ── Platform health and team: admins ──────────────────────────────────
  IF v_role = 'admin' THEN
    BEGIN
      SELECT jsonb_build_object(
               'incidents_open', (SELECT count(*) FROM public.ops_events WHERE acknowledged_at IS NULL),
               'incidents_critical', (SELECT count(*) FROM public.ops_events
                                       WHERE acknowledged_at IS NULL AND severity = 'critical'),
               'jobs_dead', (SELECT count(*) FROM public.operation_jobs WHERE status = 'dead'),
               'jobs_waiting', (SELECT count(*) FROM public.operation_jobs
                                 WHERE status IN ('pending', 'running')),
               'expiry_last_run', (SELECT last_run_at FROM public.ops_heartbeats
                                    WHERE name = 'expire_due_items'),
               'staff', (SELECT jsonb_build_object(
                                  'moderator', count(*) FILTER (WHERE role = 'moderator'),
                                  'governance_controller', count(*) FILTER (WHERE role = 'governance_controller'),
                                  'admin', count(*) FILTER (WHERE role = 'admin'))
                           FROM public.staff_roles WHERE status = 'active'))
        INTO v_section;
      v_out := v_out || jsonb_build_object('platform', v_section);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('platform', NULL);
    END;

    BEGIN
      v_section := public.retention_overview();
      v_section := jsonb_build_object('evidence_overdue', v_section->'evidence_overdue',
                                      'deletions_stuck', v_section->'deletions_stuck',
                                      'legal_holds', v_section->'legal_holds');
      v_out := v_out || jsonb_build_object('retention', v_section);
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('retention', NULL);
    END;
  END IF;

  RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.staff_nav_counts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_dashboard(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_nav_counts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_dashboard(uuid) TO service_role;

COMMIT;
