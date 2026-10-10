-- REVIEW ONLY: user-approved 90-day inactivity policy. No remote application.
-- Expiry preserves artifact/audit/hash rows. R2 removal uses the existing queue.
BEGIN;
CREATE OR REPLACE FUNCTION public.expire_inactive_kyc_submissions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  s record;
  v_ids uuid[];
  v_step_count integer;
  v_locked_count integer;
  v_total integer := 0;
  v_cutoff timestamptz := now() - interval '90 days';
BEGIN
  FOR s IN SELECT * FROM public.verification_sessions
    WHERE updated_at < v_cutoff AND (id_artifact_id IS NOT NULL OR selfie_artifact_id IS NOT NULL)
    ORDER BY user_id FOR UPDATE SKIP LOCKED
  LOOP
    -- Locks prevent a concurrent hold/profile decision from crossing expiry.
    PERFORM 1 FROM public.account_profiles ap WHERE ap.user_id=s.user_id
      AND NOT ap.legal_hold AND ap.account_verification_status <> 'verified'
      FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT count(*) INTO v_step_count FROM public.verification_steps WHERE user_id=s.user_id;
    SELECT count(*) INTO v_locked_count FROM (
      SELECT id FROM public.verification_steps WHERE user_id=s.user_id FOR UPDATE SKIP LOCKED
    ) locked_steps;
    IF v_locked_count <> v_step_count OR EXISTS (
      SELECT 1 FROM public.verification_steps st WHERE st.user_id=s.user_id
        AND greatest(st.updated_at, st.submitted_at, coalesce(st.reviewed_at, st.created_at)) >= v_cutoff
    ) OR EXISTS (
      SELECT 1 FROM public.kyc_artifacts ka WHERE ka.user_id=s.user_id AND ka.created_at >= v_cutoff
    ) OR EXISTS (
      SELECT 1 FROM public.verification_steps st JOIN public.queue_claims qc
        ON qc.item_type='verification_step' AND qc.item_id=st.id
        WHERE st.user_id=s.user_id AND qc.expires_at > now()
    ) OR EXISTS (
      SELECT 1 FROM public.verification_steps st JOIN public.decision_records d
        ON d.case_type='verification_step' AND d.case_id=st.id::text
        WHERE st.user_id=s.user_id AND (d.legal_hold OR (d.status IN ('pending_approval','escalated')
          AND (d.expires_at IS NULL OR d.expires_at > now())))
    ) THEN CONTINUE; END IF;
    SELECT array_agg(id) INTO v_ids FROM (
      SELECT id FROM public.kyc_artifacts WHERE user_id=s.user_id
        AND id IN (s.id_artifact_id,s.selfie_artifact_id)
        AND created_at < v_cutoff AND purged_at IS NULL
        AND status IN ('pending','needs_resubmission','approved')
        FOR UPDATE SKIP LOCKED
    ) locked_artifacts;
    IF v_ids IS NULL THEN CONTINUE; END IF;
    -- A due deadline immediately denies streaming, before asynchronous byte removal.
    UPDATE public.kyc_artifacts SET purge_after=now()-interval '1 microsecond', purged_at=now()
      WHERE id=ANY(v_ids);
    INSERT INTO public.r2_cleanup_queue(bucket,r2_key,reason)
      SELECT 'private',ka.r2_key,'inactive_incomplete_kyc_90d'
      FROM public.kyc_artifacts ka WHERE ka.id=ANY(v_ids)
        AND NOT EXISTS (SELECT 1 FROM public.r2_cleanup_queue q
          WHERE q.r2_key=ka.r2_key AND q.processed_at IS NULL);
    UPDATE public.verification_steps st SET status='needs_resubmission',
      id_number_encrypted=NULL,id_number_iv=NULL,id_number_tag=NULL,
      full_name=NULL,first_name=NULL,last_name=NULL,dob=NULL,
      reason_code='retention_expired',reason_note='Inactive evidence expired after 90 days; resubmit.'
      WHERE st.user_id=s.user_id AND st.step_type IN (
        SELECT ka.step_type FROM public.kyc_artifacts ka WHERE ka.id=ANY(v_ids)
      );
    UPDATE public.verification_sessions SET
      id_artifact_id=CASE WHEN id_artifact_id=ANY(v_ids) THEN NULL ELSE id_artifact_id END,
      selfie_artifact_id=CASE WHEN selfie_artifact_id=ANY(v_ids) THEN NULL ELSE selfie_artifact_id END
      WHERE id=s.id;
    v_total := v_total + cardinality(v_ids);
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_inactive_kyc_submissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_inactive_kyc_submissions() TO service_role;
CREATE OR REPLACE FUNCTION public.run_kyc_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inactive integer;
  v_rejected integer;
  v_abandoned integer;
  v_purged integer;
BEGIN
  v_inactive := public.expire_inactive_kyc_submissions();
  -- Rejected and superseded evidence, 30 days after upload.
  DELETE FROM public.kyc_artifacts ka
  WHERE ka.status = 'rejected'
    AND ka.created_at < now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM public.account_profiles ap
                    WHERE ap.user_id = ka.user_id AND ap.legal_hold);
  GET DIAGNOSTICS v_rejected = ROW_COUNT;

  -- Uploads that never reached review and are no longer attached to a session.
  DELETE FROM public.kyc_artifacts ka
  WHERE ka.status IN ('pending', 'needs_resubmission')
    AND ka.purged_at IS NULL
    AND ka.created_at < now() - interval '90 days'
    AND NOT EXISTS (SELECT 1 FROM public.verification_sessions s
                    WHERE s.id_artifact_id = ka.id OR s.selfie_artifact_id = ka.id)
    AND NOT EXISTS (SELECT 1 FROM public.account_profiles ap
                    WHERE ap.user_id = ka.user_id AND ap.legal_hold);
  GET DIAGNOSTICS v_abandoned = ROW_COUNT;

  -- Approved evidence past its purge date: delete the document once.
  WITH purged AS (
    UPDATE public.kyc_artifacts ka
    SET purged_at = now()
    WHERE ka.purge_after IS NOT NULL
      AND ka.purge_after < now()
      AND ka.purged_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.account_profiles ap
                      WHERE ap.user_id = ka.user_id AND ap.legal_hold)
    RETURNING ka.r2_key
  )
  INSERT INTO public.r2_cleanup_queue (bucket, r2_key, reason)
  SELECT DISTINCT 'private', p.r2_key, 'approved_kyc_30d_purge'
  FROM purged p
  WHERE NOT EXISTS (SELECT 1 FROM public.r2_cleanup_queue q
                    WHERE q.r2_key = p.r2_key AND q.processed_at IS NULL);
  GET DIAGNOSTICS v_purged = ROW_COUNT;

  RETURN jsonb_build_object('inactive', v_inactive, 'rejected', v_rejected, 'abandoned', v_abandoned, 'purged', v_purged);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.run_kyc_retention() FROM PUBLIC, anon, authenticated;

COMMIT;
