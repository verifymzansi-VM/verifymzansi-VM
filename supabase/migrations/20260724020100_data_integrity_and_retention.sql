-- ============================================================
-- Data integrity & retention: billing uniqueness, contact
-- submissions table, OTP challenge hardening, cron retention,
-- and retention-sweep index restore
--
--   1. entitlements: src/lib/payments/fulfillment.ts upserts with
--      onConflict "user_id,area,type" but no migration ever created
--      that constraint, so every subscription fulfillment throws
--      42P10. Duplicate rows from the unconstrained period are
--      deleted (newest row per triple kept) before the unique index
--      is created. IF NOT EXISTS covers live databases where the
--      index was already created manually.
--   2. invoices: duplicate webhook/recovery paths can double-insert
--      invoices for the same payment; only invoice_number was unique.
--      payment_id is nullable — Postgres unique indexes allow
--      multiple NULLs, which is the desired behavior for
--      payment-less invoices.
--   3. contact_submissions: the contact form route inserts here via
--      the service-role admin client and the admin inbox reads it the
--      same way, but no migration created the table. RLS is enabled
--      with NO anon/authenticated policies: all access is
--      service-role, which bypasses RLS, so no policies are needed.
--      Realtime publication membership (admin inbox live refresh) is
--      re-asserted here because the guarded block in
--      20260524003000_contact_submissions_realtime.sql is a no-op on
--      fresh replays where the table did not exist yet.
--   4. otp_challenges: a partial unique index guarantees a single
--      active (unverified) challenge per (user_id, phone) — partial
--      index predicates must be immutable, so "unexpired" cannot be
--      part of the predicate; the app deletes prior unverified
--      challenges before inserting a new one (otp_logs remains the
--      immutable audit trail), which keeps exactly one active row.
--      A pg_cron retention job mirrors the otp_logs 90-day job.
--   5. r2_cleanup_queue: processed rows were never deleted; a cron
--      now removes rows processed more than 90 days ago.
--   6. Restore the retention-sweep indexes dropped by
--      20260524061149_fix_performance_advisor_findings.sql
--      (definitions from 20260516142000_expired_post_deletion_indexes.sql
--      and 20260321000000_media_uploads_tracking.sql).
-- ============================================================

-- ── 1. entitlements (user_id, area, type) uniqueness ────────

-- Defensive pre-step: remove duplicate rows per (user_id, area, type),
-- keeping the most recently started row (ties broken by created_at,
-- then id). The unique index covers every status, so duplicates must
-- be deleted rather than voided — the app's upsert lifecycle already
-- reactivates a single row in place, so older duplicate rows are pure
-- corruption from the unconstrained period. No-op when no duplicates
-- exist.
DELETE FROM public.entitlements e
WHERE EXISTS (
  SELECT 1
  FROM public.entitlements newer
  WHERE newer.user_id = e.user_id
    AND newer.area = e.area
    AND newer.type = e.type
    AND (
      newer.started_at > e.started_at
      OR (newer.started_at = e.started_at AND newer.created_at > e.created_at)
      OR (newer.started_at = e.started_at AND newer.created_at = e.created_at AND newer.id > e.id)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_user_area_type_unique
  ON public.entitlements (user_id, area, type);

-- ── 2. invoices payment_id uniqueness ───────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_payment_id_unique
  ON public.invoices (payment_id);

-- ── 3. contact_submissions table ────────────────────────────

-- Column set derived from src/app/api/contact/general/route.ts
-- (insert: name, email, message, status) and the admin inbox reads in
-- src/lib/utils/admin-queries.ts (filter on status = 'new').
CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) <= 100),
  email TEXT NOT NULL CHECK (char_length(email) <= 320),
  message TEXT NOT NULL CHECK (char_length(message) <= 2200),
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_submissions_status_created
  ON public.contact_submissions (status, created_at DESC);

ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies on purpose: the contact form route
-- inserts and the admin inbox reads via the service-role admin client,
-- which bypasses RLS. The table must stay unreachable for user JWTs.

-- Admin inbox live refresh: assert realtime publication membership.
-- Mirrors the guarded block in 20260524003000 so fresh migration
-- replays (where the table did not exist back then) are covered too.
DO $$
BEGIN
  IF to_regclass('public.contact_submissions') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'contact_submissions'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_submissions;
  END IF;
END $$;

-- ── 4. otp_challenges: single active challenge + retention ──

-- Only one unverified challenge may exist per (user_id, phone). The
-- name matches the constraint name the app/test fixtures already
-- reference. Partial index predicates must be immutable, so expiry is
-- enforced by the app (prior unverified challenges are deleted before
-- a new one is issued) plus the retention job below.
CREATE UNIQUE INDEX IF NOT EXISTS otp_challenges_user_id_phone_key
  ON public.otp_challenges (user_id, phone)
  WHERE verified_at IS NULL;

-- Retention: delete expired/old challenges after 90 days.
-- Mirrors the otp_logs 90-day job in 20240102000000_retention_crons.sql.
-- Runs daily at 02:25 UTC.
SELECT cron.schedule(
  'retention_otp_challenges_90d',
  '25 2 * * *',
  $$
    DELETE FROM otp_challenges
    WHERE created_at < NOW() - INTERVAL '90 days';
  $$
);

-- ── 5. r2_cleanup_queue retention ───────────────────────────

-- Processed rows were marked processed but never deleted. Remove rows
-- processed more than 90 days ago. Runs daily at 02:27 UTC.
SELECT cron.schedule(
  'retention_r2_cleanup_queue_90d',
  '27 2 * * *',
  $$
    DELETE FROM r2_cleanup_queue
    WHERE processed_at IS NOT NULL
      AND processed_at < NOW() - INTERVAL '90 days';
  $$
);

-- ── 6. Restore retention-sweep indexes ──────────────────────

-- Dropped by 20260524061149_fix_performance_advisor_findings.sql but
-- still required by the retention worker sweep that permanently
-- deletes posts after their visibility window expires, and by the
-- orphan media-upload cleanup. Original definitions:
-- 20260516142000_expired_post_deletion_indexes.sql and
-- 20260321000000_media_uploads_tracking.sql.
CREATE INDEX IF NOT EXISTS idx_listings_expired_delete
  ON public.listings (expires_at)
  WHERE status = 'expired' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_expired_delete
  ON public.businesses (expires_at)
  WHERE status = 'expired' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promotions_expired_delete
  ON public.promotions (expires_at)
  WHERE status = 'expired' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_uploads_orphan
  ON public.media_uploads (confirmed_at, created_at)
  WHERE confirmed_at IS NULL;
