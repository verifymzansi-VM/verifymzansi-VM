-- REVIEW REQUIRED before production application. No object bytes are deleted here.
-- Backfill dates are reconstructed from recorded approval-era evidence, never NOW.
-- Review due-object counts and timestamp provenance; unknown anchors abort.
BEGIN;
LOCK TABLE public.account_profiles, public.verification_steps, public.kyc_artifacts
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE kyc_retention_backfill ON COMMIT DROP AS
WITH completed_steps AS (
  SELECT user_id,
    max(greatest(reviewed_at, submitted_at, phone_verified_at)) AS completed_at
  FROM public.verification_steps
  WHERE step_type IN ('phone','id_doc','selfie','location')
  GROUP BY user_id
  HAVING count(DISTINCT step_type) FILTER (WHERE status='approved') = 4
    AND count(DISTINCT step_type) FILTER (
      WHERE step_type IN ('id_doc','selfie') AND status='approved' AND reviewed_at IS NOT NULL) = 2
)
SELECT ap.user_id, coalesce(cs.completed_at, ap.legal_name_locked_at) AS completed_at
FROM public.account_profiles ap LEFT JOIN completed_steps cs ON cs.user_id=ap.user_id
WHERE ap.account_verification_status='verified' OR cs.user_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_temp.kyc_retention_backfill b
    JOIN public.kyc_artifacts ka ON ka.user_id=b.user_id
    WHERE ka.purge_after IS NULL AND ka.purged_at IS NULL
      AND (b.completed_at IS NULL OR NOT isfinite(b.completed_at) OR b.completed_at > now())
  ) THEN
    RAISE EXCEPTION 'Verified KYC retention backfill requires reviewed historical approval timestamps';
  END IF;
END; $$;

UPDATE public.kyc_artifacts ka SET purge_after=b.completed_at + interval '30 days'
FROM pg_temp.kyc_retention_backfill b
WHERE b.user_id=ka.user_id AND ka.purge_after IS NULL AND ka.purged_at IS NULL;

CREATE OR REPLACE FUNCTION public.schedule_verified_kyc_retention()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_deadline timestamptz := statement_timestamp() + interval '30 days';
        v_scheduled integer;
BEGIN
  -- Serialize different final-step approvals before inspecting completion.
  -- Failure rolls the final approval back, allowing an ordinary review retry.
  PERFORM 1 FROM public.account_profiles WHERE user_id=NEW.user_id FOR UPDATE;
  IF TG_TABLE_NAME='verification_steps' AND NOT EXISTS (
    SELECT 1 FROM public.verification_steps
    WHERE user_id=NEW.user_id AND step_type IN ('phone','id_doc','selfie','location')
    GROUP BY user_id
    HAVING count(DISTINCT step_type) FILTER (WHERE status='approved')=4
      AND count(DISTINCT step_type) FILTER (
        WHERE step_type IN ('id_doc','selfie') AND status='approved' AND reviewed_at IS NOT NULL)=2
  ) THEN RETURN NEW; END IF;

  -- Holds stop deletion in run_kyc_retention, not deadline recording.
  UPDATE public.kyc_artifacts SET purge_after=v_deadline
  WHERE user_id=NEW.user_id AND purge_after IS NULL AND purged_at IS NULL;
  GET DIAGNOSTICS v_scheduled = ROW_COUNT;
  IF v_scheduled > 0 THEN
    INSERT INTO public.audit_logs(actor_id,actor_role,action,target_type,target_id,metadata)
    VALUES ('00000000-0000-0000-0000-000000000000','system','kyc_purge_scheduled',
      'account_profile',NEW.user_id,
      jsonb_build_object('purge_after',v_deadline,'artifact_count',v_scheduled,'source',TG_TABLE_NAME));
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.schedule_verified_kyc_retention() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER schedule_verified_kyc_retention
AFTER INSERT OR UPDATE OF account_verification_status ON public.account_profiles
FOR EACH ROW WHEN (NEW.account_verification_status='verified')
EXECUTE FUNCTION public.schedule_verified_kyc_retention();
CREATE TRIGGER schedule_completed_steps_kyc_retention
AFTER INSERT OR UPDATE OF status, reviewed_at ON public.verification_steps
FOR EACH ROW WHEN (NEW.status='approved')
EXECUTE FUNCTION public.schedule_verified_kyc_retention();
COMMIT;
