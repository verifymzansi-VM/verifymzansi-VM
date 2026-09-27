-- Lift expired suspensions on a schedule.
--
-- Before this migration, the middleware tried to lift an expired suspension
-- with the member's own session. The guard_account_enforcement_columns
-- trigger (20260724020000) correctly blocks that write, so expired
-- suspensions never cleared and members stayed locked out.
--
-- pg_cron runs with auth.role() IS NULL, which the guard treats as trusted,
-- so the lift happens here instead. Each lift writes one audit row inside the
-- same statement, so a status change never exists without its audit record.
--
-- Content hidden by the suspension is NOT restored here. Restoring by
-- timestamp can republish items hidden for other reasons; precise restoration
-- from recorded effects is part of the decision execution layer.

BEGIN;

CREATE OR REPLACE FUNCTION public.lift_expired_suspensions()
RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lifted integer;
BEGIN
  WITH lifted AS (
    UPDATE public.account_profiles
       SET account_status = 'active',
           suspended_until = NULL
     WHERE account_status = 'suspended'
       AND suspended_until IS NOT NULL
       AND suspended_until <= now()
    RETURNING user_id
  ), audited AS (
    INSERT INTO public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata, reason)
    SELECT '00000000-0000-0000-0000-000000000000',
           'system',
           'account_unsuspended',
           'account_profile',
           lifted.user_id,
           jsonb_build_object('source', 'lift_expired_suspensions'),
           'Suspension period ended'
      FROM lifted
    RETURNING 1
  )
  SELECT count(*) INTO v_lifted FROM audited;

  RETURN v_lifted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lift_expired_suspensions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lift_expired_suspensions() TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('lift-expired-suspensions', '*/5 * * * *', 'SELECT public.lift_expired_suspensions()');
  END IF;
END $$;

COMMIT;
