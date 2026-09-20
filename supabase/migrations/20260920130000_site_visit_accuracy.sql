-- Correct public scope and aggregate in PostgreSQL, independent of PostgREST row caps.
CREATE OR REPLACE FUNCTION public.site_visit_area(p_path TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_path = '/' THEN 'home'
    WHEN p_path = '/mzansi-market' THEN 'mzansi_market'
    WHEN p_path = '/mzansi-business' OR p_path ~* '^/mzansi-business/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'mzansi_business'
    WHEN p_path IN ('/tourism-events', '/promotions', '/promotions/events') OR p_path ~* '^/tourism-events/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'promotions_events'
    WHEN p_path ~* '^/listing/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'shared_listings'
    WHEN p_path IN ('/pricing', '/advertise', '/contact', '/trust-safety', '/privacy', '/terms', '/paia', '/help/verification', '/safety', '/safety/scam-alerts', '/safety/meeting-checklist') THEN 'other'
    ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public.site_visit_area(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_visit_area(TEXT) TO service_role;
CREATE INDEX IF NOT EXISTS site_visits_viewer_path_created_idx
  ON public.site_visits (viewer_key, path, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_site_visit(
  p_path TEXT,
  p_referrer TEXT,
  p_viewer_key TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_area TEXT;
BEGIN
  IF p_path IS NULL OR btrim(p_path) = '' OR length(p_path) > 500
     OR p_viewer_key IS NULL OR btrim(p_viewer_key) = '' OR length(p_viewer_key) > 200 THEN
    RAISE EXCEPTION 'Invalid site visit';
  END IF;

  v_area := public.site_visit_area(p_path);
  IF v_area IS NULL THEN RETURN FALSE; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('site:' || p_path || ':' || p_viewer_key, 0));

  IF EXISTS (
    SELECT 1 FROM public.site_visits
    WHERE path = p_path
      AND viewer_key = p_viewer_key
      AND created_at > now() - interval '30 minutes'
      AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg')
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.site_visits (path, area, referrer, viewer_key, user_id)
  VALUES (p_path, v_area, left(coalesce(p_referrer, ''), 500), p_viewer_key, p_user_id);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.record_site_visit(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_site_visit(TEXT, TEXT, TEXT, UUID) TO service_role;

-- Read-only, service-role-only aggregate. Reclassify historical paths on read so
-- old internal traffic and guessed listing areas do not contaminate the report.
CREATE OR REPLACE FUNCTION public.get_site_visit_stats()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH bounds AS (
  SELECT now() AS until,
    date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AS today
), visits AS MATERIALIZED (
  SELECT v.path, public.site_visit_area(v.path) AS area, v.viewer_key,
    (v.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS day
  FROM public.site_visits v CROSS JOIN bounds b
  WHERE v.created_at >= ((b.today - interval '29 days') AT TIME ZONE 'Africa/Johannesburg')
    AND v.created_at <= b.until AND public.site_visit_area(v.path) IS NOT NULL
), totals AS (
  SELECT count(*) AS v30, count(DISTINCT viewer_key) AS u30,
    count(*) FILTER (WHERE day >= b.today::date - 6) AS v7,
    count(DISTINCT viewer_key) FILTER (WHERE day >= b.today::date - 6) AS u7,
    count(*) FILTER (WHERE day = b.today::date) AS vt,
    count(DISTINCT viewer_key) FILTER (WHERE day = b.today::date) AS ut
  FROM visits CROSS JOIN bounds b
), days AS (
  SELECT to_char(d, 'YYYY-MM-DD') AS date, count(v.viewer_key) AS visits,
    count(DISTINCT v.viewer_key) AS visitors
  FROM bounds b CROSS JOIN LATERAL generate_series(b.today - interval '13 days', b.today, interval '1 day') d
  LEFT JOIN visits v ON v.day = d::date GROUP BY d
), pages AS (
  SELECT path, count(*) AS visits FROM visits GROUP BY path ORDER BY visits DESC, path LIMIT 8
), areas AS (
  SELECT area, count(*) AS visits FROM visits GROUP BY area
)
SELECT jsonb_build_object(
  'visitsToday', vt, 'visits7d', v7, 'visits30d', v30,
  'uniqueVisitorsToday', ut, 'uniqueVisitors7d', u7, 'uniqueVisitors30d', u30,
  'daily', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY date), '[]'::jsonb) FROM days d),
  'topPages', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY visits DESC, path), '[]'::jsonb) FROM pages p),
  'byArea', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY visits DESC, area), '[]'::jsonb) FROM areas a)
) FROM totals;
$$;
REVOKE ALL ON FUNCTION public.get_site_visit_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_visit_stats() TO service_role;
