-- VerifyMzansi Data Retention Cron Jobs
-- Requires pg_cron extension (enabled by default on Supabase)
-- Run this migration after the initial schema is in place.

-- ============================================================
-- Enable pg_cron if not already enabled
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Grant usage to postgres (Supabase default)
GRANT USAGE ON SCHEMA cron TO postgres;
-- ============================================================
-- 1. Rejected KYC artifacts → 30 days
-- Deletes kyc_artifacts with status = 'rejected' older than 30 days,
-- UNLESS the seller has a legal hold.
-- Runs daily at 02:00 UTC.
-- ============================================================
SELECT cron.schedule(
  'retention_rejected_kyc_30d',
  '0 2 * * *',
  $$
    DELETE FROM kyc_artifacts
    WHERE status = 'rejected'
      AND created_at < NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1
        FROM seller_profiles sp
        WHERE sp.user_id = kyc_artifacts.user_id
          AND sp.legal_hold = true
      );
  $$
);
-- ============================================================
-- 2. Buyer V2M verification data → 6 months
-- Deletes expired or revoked buyer_verifications older than 6 months.
-- Runs daily at 02:10 UTC.
-- ============================================================
SELECT cron.schedule(
  'retention_v2m_buyer_6mo',
  '10 2 * * *',
  $$
    DELETE FROM buyer_verifications
    WHERE status IN ('expired', 'revoked')
      AND created_at < NOW() - INTERVAL '6 months';
  $$
);
-- ============================================================
-- 3. OTP logs → 90 days
-- Deletes all OTP log entries older than 90 days.
-- Runs daily at 02:20 UTC.
-- ============================================================
SELECT cron.schedule(
  'retention_otp_logs_90d',
  '20 2 * * *',
  $$
    DELETE FROM otp_logs
    WHERE created_at < NOW() - INTERVAL '90 days';
  $$
);
-- ============================================================
-- 4. Contact events → 12 months
-- Deletes contact_events older than 12 months,
-- UNLESS the associated seller has a legal hold.
-- Runs daily at 02:30 UTC.
-- ============================================================
SELECT cron.schedule(
  'retention_contact_events_12mo',
  '30 2 * * *',
  $$
    DELETE FROM contact_events
    WHERE created_at < NOW() - INTERVAL '12 months'
      AND NOT EXISTS (
        SELECT 1
        FROM seller_profiles sp
        WHERE sp.user_id = contact_events.seller_id
          AND sp.legal_hold = true
      );
  $$
);
-- ============================================================
-- 5. Listing views → 90 days
-- Deletes listing_views older than 90 days.
-- Runs daily at 02:40 UTC.
-- ============================================================
SELECT cron.schedule(
  'retention_listing_views_90d',
  '40 2 * * *',
  $$
    DELETE FROM listing_views
    WHERE created_at < NOW() - INTERVAL '90 days';
  $$
);
-- ============================================================
-- 6. Audit logs → 24 months
-- Deletes audit_logs older than 24 months,
-- UNLESS the actor has a legal hold.
-- Runs daily at 02:50 UTC.
-- ============================================================
SELECT cron.schedule(
  'retention_audit_logs_24mo',
  '50 2 * * *',
  $$
    DELETE FROM audit_logs
    WHERE created_at < NOW() - INTERVAL '24 months'
      AND NOT EXISTS (
        SELECT 1
        FROM seller_profiles sp
        WHERE sp.user_id = audit_logs.actor_id
          AND sp.legal_hold = true
      );
  $$
);
-- ============================================================
-- 7. Rejected KYC artifacts flagged for R2 cleanup → mark for worker
-- Inserts into a cleanup_queue table so the Cloudflare Worker
-- can delete the actual R2 files. Table created below.
-- ============================================================

-- Cleanup queue table for R2 file deletion by the worker
CREATE TABLE IF NOT EXISTS r2_cleanup_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
ALTER TABLE r2_cleanup_queue ENABLE ROW LEVEL SECURITY;
-- Only service role can access this table
CREATE POLICY "Service role full access on r2_cleanup_queue"
  ON r2_cleanup_queue FOR ALL
  USING (true)
  WITH CHECK (true);
-- Cron job: Queue rejected KYC R2 keys for deletion daily at 02:55 UTC
SELECT cron.schedule(
  'queue_r2_rejected_kyc_cleanup',
  '55 2 * * *',
  $$
    INSERT INTO r2_cleanup_queue (bucket, r2_key, reason)
    SELECT 'private', r2_key, 'rejected_kyc_30d'
    FROM kyc_artifacts
    WHERE status = 'rejected'
      AND created_at < NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1
        FROM seller_profiles sp
        WHERE sp.user_id = kyc_artifacts.user_id
          AND sp.legal_hold = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM r2_cleanup_queue cq
        WHERE cq.r2_key = kyc_artifacts.r2_key
          AND cq.processed_at IS NULL
      );
  $$
);
