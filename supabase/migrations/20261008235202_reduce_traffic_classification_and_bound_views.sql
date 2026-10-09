-- Follow-up to the traffic optimization: classify each distinct path once.
-- Bound post views at the same transaction timestamp as site visits, excluding
-- future-dated rows from today's, 7-day and 30-day totals.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

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
), visit_rows AS MATERIALIZED (
  SELECT v.path, v.viewer_key,
    (v.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS day
  FROM public.site_visits v CROSS JOIN bounds b
  WHERE v.created_at >= ((b.today - interval '29 days') AT TIME ZONE 'Africa/Johannesburg')
    AND v.created_at <= b.until
    AND (v.user_id IS NULL OR v.user_id NOT IN (SELECT user_id FROM staff))
), visit_paths AS MATERIALIZED (
  SELECT path, public.site_visit_area(path) AS area
  FROM (SELECT DISTINCT path FROM visit_rows) p
), visits AS MATERIALIZED (
  SELECT v.path, p.area, v.viewer_key, v.day
  FROM visit_rows v JOIN visit_paths p ON p.path = v.path
  WHERE p.area IS NOT NULL
), views AS MATERIALIZED (
  SELECT cv.source, cv.engaged, (cv.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS day
  FROM public.content_views cv CROSS JOIN bounds b
  WHERE cv.created_at >= ((b.today - interval '29 days') AT TIME ZONE 'Africa/Johannesburg')
    AND cv.created_at <= b.until
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

REVOKE ALL ON FUNCTION public.get_site_visit_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_visit_stats() TO service_role;
