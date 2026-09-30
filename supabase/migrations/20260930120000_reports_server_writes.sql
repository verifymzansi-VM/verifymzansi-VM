-- Reports are written only by POST /api/reports with the service role, which
-- applies Turnstile, rate limiting, IP hashing, sanitising and the fixed
-- 'open'/'standard' triage fields.
--
--  1. The route inserts evidence_urls, a column production never had, so
--     every report submission failed (PostgREST rejects unknown columns).
--  2. The description check (20..500) was stricter than the route's
--     validation (10..2000), so valid submissions failed with a 500.
--  3. Signed-in users could insert straight through PostgREST, skipping the
--     route's checks and choosing their own status, severity, assignee and
--     IP hash. The app never used that path, so it goes.
BEGIN;

ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS evidence_urls text[];

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_evidence_urls_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_evidence_urls_check
  CHECK (evidence_urls IS NULL OR cardinality(evidence_urls) <= 5);

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_description_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_description_check
  CHECK (char_length(description) BETWEEN 10 AND 2000);

DROP POLICY IF EXISTS reports_insert_authenticated ON public.reports;
REVOKE INSERT, UPDATE, DELETE ON public.reports FROM anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
