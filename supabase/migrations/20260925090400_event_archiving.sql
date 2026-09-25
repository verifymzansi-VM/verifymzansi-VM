-- Free events: Draft → Published → Active → Ended (expired by the retention
-- worker at end_date) → Archived after `events.archiveAfterDays`. Archived
-- events stay in the owner's dashboard history but leave public event pages.
BEGIN;

CREATE FUNCTION public.archive_ended_events() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
 UPDATE public.promotions p
 SET status = 'archived', status_reason = 'Event ended'
 WHERE to_jsonb(p)->>'promotion_type' = 'event'
  AND p.status = 'expired'
  AND p.end_date IS NOT NULL
  AND p.end_date < now() - make_interval(days => public.commercial_setting_int('events','archiveAfterDays',30));
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.archive_ended_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_ended_events() TO service_role;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
  PERFORM cron.schedule('archive-ended-events','50 3 * * *','SELECT public.archive_ended_events()');
 END IF;
END $$;

COMMIT;
