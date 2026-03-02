-- VerifyMzansi KYC Approved-Seller Retention Purge
-- Queues KYC artifacts for R2 deletion 30 days after full seller verification.
-- Runs daily at 02:58 UTC (after existing crons that run from 02:00-02:55).
-- Legal hold sellers are always excluded.

SELECT cron.schedule(
  'queue_r2_approved_kyc_purge_30d',
  '58 2 * * *',
  $$
    INSERT INTO r2_cleanup_queue (bucket, r2_key, reason)
    SELECT
      'verifymzansi-private',
      ka.r2_key,
      'approved_kyc_30d_purge'
    FROM kyc_artifacts ka
    WHERE ka.purge_after IS NOT NULL
      AND ka.purge_after < NOW()
      -- Skip sellers with legal hold
      AND NOT EXISTS (
        SELECT 1
        FROM seller_profiles sp
        WHERE sp.user_id = ka.user_id
          AND sp.legal_hold = true
      )
      -- Skip if already queued and not yet processed
      AND NOT EXISTS (
        SELECT 1
        FROM r2_cleanup_queue cq
        WHERE cq.r2_key = ka.r2_key
          AND cq.processed_at IS NULL
      );
  $$
);
