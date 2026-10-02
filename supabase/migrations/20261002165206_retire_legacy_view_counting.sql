-- Retire the legacy view counter. Apply AFTER the app that calls
-- record_content_views is deployed: the old app still calls these functions.
--
-- The old system counted a person once per post forever (a returning visitor
-- never counted again), only counted video plays that reached 30 seconds,
-- missed full-screen plays, and filed tourism-business views under the wrong
-- post type. Its totals were carried into the view_count columns by
-- 20261002135800_content_views_v2, so nothing shown to owners is lost.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'retention_listing_views_90d';

DROP FUNCTION IF EXISTS public.record_content_playback(UUID, TEXT, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.record_content_view(UUID, TEXT, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.increment_promotion_view_count(UUID);
DROP TABLE IF EXISTS public.listing_views;
