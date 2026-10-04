-- Bind high-risk overrides to the reviewed submission. Legacy proposals
-- without a snapshot cannot be approved or executed; review them again.
ALTER TABLE public.verification_steps
  ADD COLUMN override_decision_id uuid REFERENCES public.decision_records(id);

-- Keep the old signature callable but fail closed for clients that cannot
-- supply the reviewed version. The replacement overload is service-only.
CREATE OR REPLACE FUNCTION public.propose_kyc_override(
  p_actor uuid, p_step uuid, p_user uuid, p_risk_level text, p_override_reason text, p_note text
) RETURNS jsonb LANGUAGE sql SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('ok', false, 'error', 'step_changed');
$$;

CREATE OR REPLACE FUNCTION public.propose_kyc_override(
  p_actor uuid, p_step uuid, p_user uuid, p_risk_level text, p_override_reason text, p_note text,
  p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  v_decision uuid;
  v_step public.verification_steps%ROWTYPE;
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
  SELECT * INTO v_step FROM public.verification_steps WHERE id = p_step FOR UPDATE;
  IF NOT FOUND OR v_step.user_id IS DISTINCT FROM p_user
     OR v_step.updated_at IS DISTINCT FROM p_expected_updated_at
     OR p_expected_updated_at IS NULL
     OR v_step.status NOT IN ('pending', 'needs_resubmission')
     OR v_step.risk_level IS DISTINCT FROM p_risk_level
     OR v_step.risk_level IS NULL OR v_step.risk_level NOT IN ('high', 'critical') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_changed');
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
                       'risk_level', p_risk_level, 'step_updated_at', v_step.updated_at),
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

REVOKE ALL ON FUNCTION public.propose_kyc_override(uuid, uuid, uuid, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propose_kyc_override(uuid, uuid, uuid, text, text, text, timestamptz)
  TO service_role;

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
  v_step public.verification_steps%ROWTYPE;
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

  -- Lock and validate the original submission before approving. Execution
  -- still uses the same version in a conditional update after this commits.
  IF d.action_category = 'kyc_override' THEN
    SELECT * INTO v_step FROM public.verification_steps
     WHERE id = (d.payload->>'step_id')::uuid
       AND user_id = (d.payload->>'user_id')::uuid
       AND updated_at = (d.payload->>'step_updated_at')::timestamptz
       AND status IN ('pending', 'needs_resubmission')
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'step_changed');
    END IF;
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
