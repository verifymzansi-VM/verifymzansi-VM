-- Supabase advisor clean-up after the launch hardening.
--
-- 1. Server-only tables: RLS is on with no policies, so only the service role
--    (which bypasses RLS) can use them. State that explicitly, as the billing
--    and audit tables already do, so the intent is visible and the advisor
--    stops reporting them. Access for anon and authenticated is unchanged.
-- 2. Drop indexes whose columns are the leading columns of another index on
--    the same table: they are never needed and cost every write.
-- 3. pg_cron keeps every run forever; its history table was already the
--    largest in the database. Keep 14 days.

BEGIN;

-- 1. Explicit service-role policies -------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'account_free_post_allowances', 'analytics_daily', 'analytics_events',
    'commercial_notices', 'contact_submissions', 'intro_trial_audit',
    'intro_trial_campaigns', 'intro_trial_identities', 'intro_trial_notices',
    'organisation_notices', 'otp_challenges', 'site_visits'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Service role manages %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Service role manages %1$s" ON public.%1$I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t);
  END LOOP;
END;
$$;

-- 2. Redundant indexes ------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_account_profiles_user_id;   -- seller_profiles_user_id_key (user_id)
DROP INDEX IF EXISTS public.idx_entitlements_user;          -- idx_entitlements_user_area_type_unique
DROP INDEX IF EXISTS public.idx_entitlements_user_area;     -- idx_entitlements_user_area_type_unique
DROP INDEX IF EXISTS public.idx_invoices_payment_id;        -- idx_invoices_payment_id_unique
DROP INDEX IF EXISTS public.idx_promotions_type;            -- idx_promotions_type_status_created
DROP INDEX IF EXISTS public.idx_verification_steps_user;    -- verification_steps_user_id_step_type_key

-- 3. pg_cron run history -----------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'retention_cron_run_history_14d';
    PERFORM cron.schedule(
      'retention_cron_run_history_14d',
      '45 2 * * *',
      $cmd$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '14 days'$cmd$
    );
  END IF;
END;
$$;

COMMIT;
