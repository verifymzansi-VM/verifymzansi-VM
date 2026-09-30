-- Commit callback evidence, risk and audit together. A failed write remains retryable.
-- Service-only: an authenticated account must never decide its own KYC result.
CREATE OR REPLACE FUNCTION public.apply_kyc_provider_webhook(
  p_provider_ref text,
  p_status text,
  p_scores jsonb DEFAULT '{}',
  p_ocr_payload jsonb DEFAULT NULL,
  p_raw_response jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result public.kyc_provider_results%ROWTYPE;
  v_artifact public.kyc_artifacts%ROWTYPE;
  v_step public.verification_steps%ROWTYPE;
  v_risk integer;
  v_current_artifact uuid;
  v_current_artifact_created_at timestamptz;
  v_step_updated boolean := false;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('approved', 'rejected', 'needs_manual_review') THEN
    RAISE EXCEPTION 'Invalid provider status' USING ERRCODE = '22023';
  END IF;
  IF p_scores IS NULL OR jsonb_typeof(p_scores) <> 'object'
     OR (p_ocr_payload IS NOT NULL AND jsonb_typeof(p_ocr_payload) <> 'object')
     OR (p_raw_response IS NOT NULL AND jsonb_typeof(p_raw_response) <> 'object') THEN
    RAISE EXCEPTION 'Invalid provider metadata' USING ERRCODE = '22023';
  END IF;
  -- STRICT refuses ambiguous references instead of deciding the wrong account.
  BEGIN
    SELECT * INTO STRICT v_result FROM public.kyc_provider_results
      WHERE provider_ref = p_provider_ref;
  EXCEPTION WHEN no_data_found THEN
    RETURN jsonb_build_object('outcome', 'unknown');
  END;
  -- Match artifact deletion's lock order (artifact, then cascading provider
  -- rows) instead of introducing a provider/artifact deadlock inversion.
  SELECT * INTO STRICT v_artifact FROM public.kyc_artifacts
    WHERE id = v_result.artifact_id AND user_id = v_result.user_id FOR UPDATE;
  SELECT * INTO STRICT v_result FROM public.kyc_provider_results
    WHERE provider_ref = p_provider_ref FOR UPDATE;
  IF v_result.artifact_id <> v_artifact.id OR v_result.user_id <> v_artifact.user_id THEN
    RAISE EXCEPTION 'KYC provider reference changed; retry callback' USING ERRCODE = '40001';
  END IF;
  IF v_result.provider_status <> 'pending' THEN
    RETURN jsonb_build_object('outcome', 'duplicate', 'provider_result_id', v_result.id);
  END IF;
  SELECT * INTO v_step FROM public.verification_steps
    WHERE user_id = v_result.user_id AND step_type = v_artifact.step_type FOR UPDATE;
  -- A callback for a replaced upload is evidence only, never the current decision.
  SELECT CASE v_artifact.step_type::text
    WHEN 'id_doc' THEN id_artifact_id WHEN 'selfie' THEN selfie_artifact_id END
    INTO v_current_artifact FROM public.verification_sessions
    WHERE user_id = v_result.user_id FOR UPDATE;
  -- Upload persists its provider row before the step and canonical session.
  -- Do not terminalize a callback in that publication window: the provider
  -- must retry after upload completes, instead of losing the step update.
  IF v_artifact.status = 'pending' AND (v_step.id IS NULL OR v_step.status = 'pending') THEN
    SELECT created_at INTO v_current_artifact_created_at FROM public.kyc_artifacts
      WHERE id = v_current_artifact AND user_id = v_result.user_id;
    IF v_step.id IS NULL OR v_current_artifact IS NULL
       OR (v_current_artifact <> v_artifact.id
           AND (v_current_artifact_created_at IS NULL
                OR v_current_artifact_created_at <= v_artifact.created_at)) THEN
      RAISE EXCEPTION 'KYC upload is not yet published; retry callback' USING ERRCODE = '40001';
    END IF;
  END IF;
  IF v_artifact.status = 'pending' AND v_step.id IS NOT NULL AND v_step.status = 'pending'
     AND v_current_artifact = v_artifact.id THEN
    v_risk := least(coalesce(v_step.risk_score, 0) + CASE WHEN p_status = 'rejected' THEN 30 ELSE 0 END, 100);
    UPDATE public.verification_steps SET
      auto_status = p_status,
      risk_score = v_risk,
      risk_level = CASE WHEN v_risk <= 25 THEN 'low' WHEN v_risk <= 50 THEN 'medium'
                        WHEN v_risk <= 75 THEN 'high' ELSE 'critical' END
      WHERE id = v_step.id;
    v_step_updated := true;
  END IF;

  UPDATE public.kyc_provider_results SET
    provider_status = p_status,
    face_match_score = CASE WHEN p_scores ? 'face_match_score' THEN (p_scores->>'face_match_score')::numeric ELSE face_match_score END,
    liveness_score = CASE WHEN p_scores ? 'liveness_score' THEN (p_scores->>'liveness_score')::numeric ELSE liveness_score END,
    doc_auth_score = CASE WHEN p_scores ? 'doc_auth_score' THEN (p_scores->>'doc_auth_score')::numeric ELSE doc_auth_score END,
    ocr_payload = coalesce(p_ocr_payload, ocr_payload),
    raw_response = coalesce(p_raw_response, raw_response)
    WHERE id = v_result.id;
  INSERT INTO public.audit_logs(actor_id, actor_role, action, target_type, target_id, metadata)
    VALUES ('00000000-0000-0000-0000-000000000000', 'system', 'kyc_provider_webhook_received',
      'kyc_provider_result', v_result.id,
      jsonb_build_object('provider_ref', p_provider_ref, 'status', p_status,
                        'user_id', v_result.user_id, 'step_updated', v_step_updated));
  RETURN jsonb_build_object('outcome', 'applied', 'provider_result_id', v_result.id);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_kyc_provider_webhook(text, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_kyc_provider_webhook(text, text, jsonb, jsonb, jsonb) TO service_role;
