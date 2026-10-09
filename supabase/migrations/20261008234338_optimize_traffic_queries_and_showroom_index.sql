-- Group daily traffic once instead of rescanning materialized visits/views 14 times.
-- Batch primary-key lookups for content totals; preserve missing/unknown IDs as zero.
-- A partial covering index serves the measured showroom exposure aggregation.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX idx_analytics_showroom_surface_created_cover
  ON public.analytics_events (surface, created_at DESC) INCLUDE (content_id)
  WHERE event_type = 'showroom_appearance';

CREATE OR REPLACE FUNCTION public.get_site_visit_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
WITH bounds AS (
  SELECT now() AS until,
    date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AS today
), staff AS MATERIALIZED (
  SELECT DISTINCT user_id FROM public.staff_roles WHERE status = 'active'
), visits AS MATERIALIZED (
  SELECT v.path, public.site_visit_area(v.path) AS area, v.viewer_key,
    (v.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS day
  FROM public.site_visits v CROSS JOIN bounds b
  WHERE v.created_at >= ((b.today - interval '29 days') AT TIME ZONE 'Africa/Johannesburg')
    AND v.created_at <= b.until AND public.site_visit_area(v.path) IS NOT NULL
    AND (v.user_id IS NULL OR v.user_id NOT IN (SELECT user_id FROM staff))
), views AS MATERIALIZED (
  SELECT cv.source, cv.engaged, (cv.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS day
  FROM public.content_views cv CROSS JOIN bounds b
  WHERE cv.created_at >= ((b.today - interval '29 days') AT TIME ZONE 'Africa/Johannesburg')
), totals AS (
  SELECT count(*) AS v30, count(DISTINCT viewer_key) AS u30,
    count(*) FILTER (WHERE day >= b.today::date - 6) AS v7,
    count(DISTINCT viewer_key) FILTER (WHERE day >= b.today::date - 6) AS u7,
    count(*) FILTER (WHERE day = b.today::date) AS vt,
    count(DISTINCT viewer_key) FILTER (WHERE day = b.today::date) AS ut
  FROM visits CROSS JOIN bounds b
), view_totals AS (
  SELECT count(*) FILTER (WHERE day = b.today::date) AS today,
    count(*) FILTER (WHERE day >= b.today::date - 6) AS d7,
    count(*) AS d30,
    count(*) FILTER (WHERE day >= b.today::date - 6 AND source = 'video') AS video7d,
    count(*) FILTER (WHERE day >= b.today::date - 6 AND engaged) AS engaged7d
  FROM views CROSS JOIN bounds b
), visits_by_day AS (
  SELECT day, count(*) AS visits, count(DISTINCT viewer_key) AS visitors
  FROM visits GROUP BY day
), views_by_day AS (
  SELECT day, count(*) AS post_views FROM views GROUP BY day
), days AS (
  SELECT to_char(d, 'YYYY-MM-DD') AS date,
    COALESCE(v.visits, 0) AS visits,
    COALESCE(v.visitors, 0) AS visitors,
    COALESCE(w.post_views, 0) AS "postViews"
  FROM bounds b
  CROSS JOIN LATERAL generate_series(b.today - interval '13 days', b.today, interval '1 day') d
  LEFT JOIN visits_by_day v ON v.day = d::date
  LEFT JOIN views_by_day w ON w.day = d::date
), pages AS (
  SELECT path, count(*) AS visits FROM visits GROUP BY path ORDER BY visits DESC, path LIMIT 8
), areas AS (
  SELECT area, count(*) AS visits FROM visits GROUP BY area
)
SELECT jsonb_build_object(
  'visitsToday', vt, 'visits7d', v7, 'visits30d', v30,
  'uniqueVisitorsToday', ut, 'uniqueVisitors7d', u7, 'uniqueVisitors30d', u30,
  'postViewsToday', (SELECT today FROM view_totals),
  'postViews7d', (SELECT d7 FROM view_totals),
  'postViews30d', (SELECT d30 FROM view_totals),
  'videoViews7d', (SELECT video7d FROM view_totals),
  'engagedViews7d', (SELECT engaged7d FROM view_totals),
  'daily', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY date), '[]'::jsonb) FROM days d),
  'topPages', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY visits DESC, path), '[]'::jsonb) FROM pages p),
  'byArea', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY visits DESC, area), '[]'::jsonb) FROM areas a)
) FROM totals;
$function$;

CREATE OR REPLACE FUNCTION public.get_content_view_counts(p_target_ids UUID[], p_target_type TEXT)
RETURNS TABLE(target_id UUID, view_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH requested AS MATERIALIZED (
    SELECT DISTINCT UNNEST(COALESCE(p_target_ids, ARRAY[]::UUID[])) AS target_id
  ), counts AS (
    SELECT l.id, l.view_count FROM public.listings l
    WHERE p_target_type = 'listing' AND l.id = ANY(p_target_ids)
    UNION ALL
    SELECT b.id, b.view_count FROM public.businesses b
    WHERE p_target_type = 'business' AND b.id = ANY(p_target_ids)
    UNION ALL
    SELECT p.id, p.view_count FROM public.promotions p
    WHERE p_target_type = 'promotion' AND p.id = ANY(p_target_ids)
  )
  SELECT r.target_id, COALESCE(c.view_count, 0)::BIGINT
  FROM requested r LEFT JOIN counts c ON c.id = r.target_id;
$function$;

-- Existing service-only RPC contracts must remain service-only.
REVOKE ALL ON FUNCTION public.get_site_visit_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_content_view_counts(UUID[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_visit_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_content_view_counts(UUID[], TEXT) TO service_role;
