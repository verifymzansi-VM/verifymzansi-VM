-- Edit requests stuck in "processing" (posting audit 2026-10-07).
--
-- Approving an edit claims it as "processing"; a crash before release left it
-- there for good: out of the queue (which counts "pending") and blocking the
-- owner's next edit (the unique index covers pending and processing). Every
-- ten minutes, claims older than ten minutes go back to "pending". Re-approving
-- an edit that was in fact applied is safe: the snapshot check then closes it.

CREATE OR REPLACE FUNCTION public.release_stuck_edit_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.content_edit_requests
     SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL
   WHERE status = 'processing'
     AND coalesce(reviewed_at, created_at) < now() - interval '10 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_stuck_edit_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stuck_edit_requests() TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'release_stuck_edit_requests';
    PERFORM cron.schedule('release_stuck_edit_requests', '*/10 * * * *',
                          'SELECT public.release_stuck_edit_requests()');
  END IF;
END;
$$;
