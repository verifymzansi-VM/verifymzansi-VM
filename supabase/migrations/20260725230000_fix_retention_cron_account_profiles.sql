-- ============================================================
-- Fix retention cron jobs still referencing the pre-rename
-- seller_profiles table (and contact_events.seller_id).
--
-- The seller_profiles table was renamed to account_profiles and
-- contact_events.seller_id became contact_events.owner_id during
-- the account/member unification (20260310223000, 20260311120000).
-- Four pg_cron jobs created before that rename have been failing
-- every night with `relation "seller_profiles" does not exist`:
--
--   retention_rejected_kyc_30d       (job 1)
--   retention_contact_events_12mo    (job 4)
--   retention_audit_logs_24mo        (job 6)
--   queue_r2_rejected_kyc_cleanup    (job 7)
--
-- This migration rewrites their commands in place via
-- cron.alter_job, preserving name and schedule. Semantics are
-- unchanged: rows are only purged when the associated account is
-- not under legal_hold.
-- ============================================================

DO $$
BEGIN
  -- ── retention_rejected_kyc_30d ─────────────────────────────
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_rejected_kyc_30d') THEN
    PERFORM cron.alter_job(
      (SELECT jobid FROM cron.job WHERE jobname = 'retention_rejected_kyc_30d'),
      command := $cmd$
    DELETE FROM kyc_artifacts
    WHERE status = 'rejected'
      AND created_at < NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.account_profiles ap
        WHERE ap.user_id = kyc_artifacts.user_id
          AND ap.legal_hold = true
      );
  $cmd$
    );
  END IF;

  -- ── retention_contact_events_12mo ──────────────────────────
  -- contact_events.seller_id was renamed to owner_id; the legal
  -- hold check follows the content owner.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_contact_events_12mo') THEN
    PERFORM cron.alter_job(
      (SELECT jobid FROM cron.job WHERE jobname = 'retention_contact_events_12mo'),
      command := $cmd$
    DELETE FROM contact_events
    WHERE created_at < NOW() - INTERVAL '12 months'
      AND NOT EXISTS (
        SELECT 1
        FROM public.account_profiles ap
        WHERE ap.user_id = contact_events.owner_id
          AND ap.legal_hold = true
      );
  $cmd$
    );
  END IF;

  -- ── retention_audit_logs_24mo ──────────────────────────────
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_audit_logs_24mo') THEN
    PERFORM cron.alter_job(
      (SELECT jobid FROM cron.job WHERE jobname = 'retention_audit_logs_24mo'),
      command := $cmd$
    DELETE FROM audit_logs
    WHERE created_at < NOW() - INTERVAL '24 months'
      AND NOT EXISTS (
        SELECT 1
        FROM public.account_profiles ap
        WHERE ap.user_id = audit_logs.actor_id
          AND ap.legal_hold = true
      );
  $cmd$
    );
  END IF;

  -- ── queue_r2_rejected_kyc_cleanup ──────────────────────────
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'queue_r2_rejected_kyc_cleanup') THEN
    PERFORM cron.alter_job(
      (SELECT jobid FROM cron.job WHERE jobname = 'queue_r2_rejected_kyc_cleanup'),
      command := $cmd$
    INSERT INTO r2_cleanup_queue (bucket, r2_key, reason)
    SELECT 'private', r2_key, 'rejected_kyc_30d'
    FROM kyc_artifacts
    WHERE status = 'rejected'
      AND created_at < NOW() - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.account_profiles ap
        WHERE ap.user_id = kyc_artifacts.user_id
          AND ap.legal_hold = true
      )
      AND NOT EXISTS (
        SELECT 1
        FROM r2_cleanup_queue cq
        WHERE cq.r2_key = kyc_artifacts.r2_key
          AND cq.processed_at IS NULL
      );
  $cmd$
    );
  END IF;
END $$;
