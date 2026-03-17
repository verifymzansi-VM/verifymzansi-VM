-- Reassert restrictive service-role policies and normalize queued cleanup records.
-- This migration protects against schema drift on privileged tables and ensures
-- the approved-KYC purge cron queues bucket aliases the worker understands.

DROP POLICY IF EXISTS "Service role full access on r2_cleanup_queue"
  ON public.r2_cleanup_queue;

CREATE POLICY "Service role full access on r2_cleanup_queue"
  ON public.r2_cleanup_queue
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can insert notifications"
  ON public.notifications;

CREATE POLICY "Service role can insert notifications"
  ON public.notifications
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access on otp_challenges"
  ON public.otp_challenges;

CREATE POLICY "Service role full access on otp_challenges"
  ON public.otp_challenges
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

UPDATE public.r2_cleanup_queue
SET bucket = 'private'
WHERE processed_at IS NULL
  AND bucket IN ('verifymzansi-private');

UPDATE public.r2_cleanup_queue
SET bucket = 'public'
WHERE processed_at IS NULL
  AND bucket IN ('verifymzansi-public');

DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id
  FROM cron.job
  WHERE jobname = 'queue_r2_approved_kyc_purge_30d';

  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'queue_r2_approved_kyc_purge_30d',
    '58 2 * * *',
    $cron$
      INSERT INTO public.r2_cleanup_queue (bucket, r2_key, reason)
      SELECT
        'private',
        ka.r2_key,
        'approved_kyc_30d_purge'
      FROM public.kyc_artifacts ka
      WHERE ka.purge_after IS NOT NULL
        AND ka.purge_after < NOW()
        AND NOT EXISTS (
          SELECT 1
          FROM public.account_profiles ap
          WHERE ap.user_id = ka.user_id
            AND ap.legal_hold = true
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.r2_cleanup_queue cq
          WHERE cq.r2_key = ka.r2_key
            AND cq.processed_at IS NULL
        );
    $cron$
  );
END
$$;