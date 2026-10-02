-- Fair showroom rotation, honest exposure reporting and admin traffic fixes.
--
-- Everyone pays the same, so every live post gets an equal chance at the
-- showroom ("rotate evenly"). Posts that have been shown least in the last 7
-- days move to the front; new posts get a 72-hour starter window; posts in the
-- visitor's province are offered first, with national posts mixed in.
-- Exposure is the viewable "showroom_appearance" event recorded per surface
-- (showroom:home, showroom:business, showroom:market, showroom:tourism).

CREATE INDEX IF NOT EXISTS idx_analytics_events_type_surface_created
  ON public.analytics_events (event_type, surface, created_at DESC);

-- Seed/test posts (same rule as src/lib/utils/placeholder-content.ts): a
-- bracketed tag or the words placeholder/sandbox. They are hidden on the
-- site, so they must not take showroom places or count toward fair share.
CREATE OR REPLACE FUNCTION public.is_placeholder_content(p_title TEXT, p_description TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT concat_ws(' ', p_title, p_description) ~* '\[(seed|demo|sample|placeholder|sandbox|test)\]'
      OR concat_ws(' ', p_title, p_description) ~* '\m(placeholder|sandbox)\M'
$$;

-- ── Eligible posts per showroom ─────────────────────────────────────────────
-- Mirrors the public page filters: live, inside the paid window (or the
-- 30-day legacy free window), and the section's own area rules.
CREATE OR REPLACE FUNCTION public.showroom_candidates(p_surface TEXT)
RETURNS TABLE(content_table TEXT, content_id UUID, province TEXT, live_at TIMESTAMPTZ,
  has_video BOOLEAN, title TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT 'businesses', b.id, b.location_province, COALESCE(b.published_at, b.created_at),
    COALESCE(b.cover_video, '') <> '', b.business_name
  FROM public.businesses b
  WHERE p_surface IN ('home', 'business', 'tourism')
    AND b.status::TEXT = 'live'
    AND (b.expires_at > now() OR (b.expires_at IS NULL AND b.created_at > now() - interval '30 days'))
    AND NOT public.is_placeholder_content(b.business_name, b.description)
    AND (p_surface = 'home'
      OR (p_surface = 'business' AND b.area::TEXT = 'MZANSI_BUSINESS')
      OR (p_surface = 'tourism' AND b.category::TEXT = 'tourism_hospitality'))
  UNION ALL
  SELECT 'listings', l.id, l.location_province, COALESCE(l.published_at, l.created_at),
    COALESCE(array_length(l.videos, 1), 0) > 0, l.title
  FROM public.listings l
  WHERE p_surface IN ('home', 'market')
    AND l.status::TEXT = 'live' AND l.area::TEXT = 'MZANSI_MARKET'
    AND NOT public.is_placeholder_content(l.title, l.description)
    AND (l.expires_at > now() OR (l.expires_at IS NULL AND l.created_at > now() - interval '30 days'))
  UNION ALL
  SELECT 'promotions', p.id, p.location_province, COALESCE(p.published_at, p.created_at),
    COALESCE(array_length(p.videos, 1), 0) > 0, p.title
  FROM public.promotions p
  WHERE p_surface IN ('home', 'tourism')
    AND p.status::TEXT = 'live'
    AND NOT public.is_placeholder_content(p.title, p.description)
    AND (p.expires_at > now() OR (p.expires_at IS NULL AND p.created_at > now() - interval '30 days'))
    AND (p_surface = 'home'
      OR (p.promotion_type::TEXT = 'event' AND (p.end_date IS NULL OR p.end_date >= now())));
$$;

-- ── Ranked feed ─────────────────────────────────────────────────────────────
-- Score = exposure gap (main factor) + 72h new-post window + small video bonus
-- + a little randomness so the order cannot be predicted or gamed. Returns
-- the best local and the best national candidates; the app interleaves them.
CREATE OR REPLACE FUNCTION public.get_showroom_feed(
  p_surface TEXT,
  p_province TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE(content_table TEXT, content_id UUID, is_local BOOLEAN, is_new BOOLEAN)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH cand AS (
    SELECT * FROM public.showroom_candidates(p_surface)
  ), exposure AS (
    SELECT e.content_id, count(*)::NUMERIC AS shown
    FROM public.analytics_events e
    WHERE e.event_type = 'showroom_appearance'
      AND e.surface = 'showroom:' || p_surface
      AND e.created_at > now() - interval '7 days'
    GROUP BY e.content_id
  ), joined AS (
    SELECT c.*, COALESCE(x.shown, 0) AS shown,
      p_province IS NOT NULL
        AND lower(btrim(COALESCE(c.province, ''))) = lower(btrim(p_province)) AS is_local,
      c.live_at > now() - interval '72 hours' AS is_new
    FROM cand c LEFT JOIN exposure x ON x.content_id = c.content_id
  ), fair AS (
    SELECT GREATEST(avg(shown), 1) AS share FROM joined
  ), scored AS (
    SELECT j.content_table, j.content_id, j.is_local, j.is_new,
      (f.share - j.shown) / f.share
        + CASE WHEN j.is_new THEN 1 ELSE 0 END
        + CASE WHEN j.has_video THEN 0.15 ELSE 0 END
        + random() * 0.3 AS score
    FROM joined j CROSS JOIN fair f
  ), ranked AS (
    SELECT s.*, row_number() OVER (PARTITION BY s.is_local ORDER BY s.score DESC) AS rn
    FROM scored s
  )
  SELECT content_table, content_id, is_local, is_new
  FROM ranked
  WHERE rn <= LEAST(GREATEST(p_limit, 1), 100)
  ORDER BY score DESC;
$$;

-- ── Fair-share reporting ────────────────────────────────────────────────────
-- Per showroom: how many eligible posts there are, the average (fair share)
-- of viewable appearances per post over 7 days, and each requested post's own
-- appearances. Used by the owner dashboard.
CREATE OR REPLACE FUNCTION public.get_showroom_fair_share(p_ids UUID[])
RETURNS TABLE(surface TEXT, content_id UUID, appearances_7d BIGINT, fair_share_7d NUMERIC,
  eligible_posts BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH surfaces(s) AS (VALUES ('home'), ('business'), ('market'), ('tourism')),
  cand AS (
    SELECT s.s AS surface, c.content_id
    FROM surfaces s CROSS JOIN LATERAL public.showroom_candidates(s.s) c
  ), shown AS (
    SELECT substr(e.surface, 10) AS surface, e.content_id, count(*) AS n
    FROM public.analytics_events e
    WHERE e.event_type = 'showroom_appearance' AND e.surface LIKE 'showroom:%'
      AND e.created_at > now() - interval '7 days'
    GROUP BY 1, 2
  ), per_surface AS (
    SELECT c.surface, count(*) AS posts,
      COALESCE(sum(sh.n), 0)::NUMERIC / NULLIF(count(*), 0) AS fair
    FROM cand c LEFT JOIN shown sh ON sh.surface = c.surface AND sh.content_id = c.content_id
    GROUP BY c.surface
  )
  SELECT c.surface, c.content_id, COALESCE(sh.n, 0), round(ps.fair, 1), ps.posts
  FROM cand c
  JOIN per_surface ps ON ps.surface = c.surface
  LEFT JOIN shown sh ON sh.surface = c.surface AND sh.content_id = c.content_id
  WHERE c.content_id = ANY(COALESCE(p_ids, ARRAY[]::UUID[]));
$$;

-- ── Zero-exposure alarm for admin ───────────────────────────────────────────
-- Live posts eligible for a showroom that had no viewable appearance there in
-- the last 24 hours. The ranking already moves them to the front; this list
-- lets staff see that it worked.
CREATE OR REPLACE FUNCTION public.get_showroom_exposure_report()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH surfaces(s) AS (VALUES ('home'), ('business'), ('market'), ('tourism')),
  cand AS (
    SELECT s.s AS surface, c.*
    FROM surfaces s CROSS JOIN LATERAL public.showroom_candidates(s.s) c
  ), shown AS (
    SELECT substr(e.surface, 10) AS surface, e.content_id,
      count(*) FILTER (WHERE e.created_at > now() - interval '24 hours') AS d1,
      count(*) AS d7
    FROM public.analytics_events e
    WHERE e.event_type = 'showroom_appearance' AND e.surface LIKE 'showroom:%'
      AND e.created_at > now() - interval '7 days'
    GROUP BY 1, 2
  ), joined AS (
    SELECT c.*, COALESCE(sh.d1, 0) AS d1, COALESCE(sh.d7, 0) AS d7
    FROM cand c LEFT JOIN shown sh ON sh.surface = c.surface AND sh.content_id = c.content_id
  )
  SELECT jsonb_build_object(
    'surfaces', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'surface', surface, 'posts', posts, 'appearances7d', total,
        'fairShare7d', round(total::NUMERIC / NULLIF(posts, 0), 1),
        'lowest7d', lowest, 'highest7d', highest
      ) ORDER BY surface), '[]'::JSONB)
      FROM (SELECT surface, count(*) AS posts, sum(d7) AS total, min(d7) AS lowest,
              max(d7) AS highest FROM joined GROUP BY surface) t
    ),
    'zeroExposure', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'surface', surface, 'table', content_table, 'id', content_id, 'title', title,
        'province', province, 'liveSince', live_at
      ) ORDER BY live_at), '[]'::JSONB)
      FROM joined WHERE d1 = 0 AND live_at < now() - interval '2 hours'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.showroom_candidates(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_showroom_feed(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_showroom_fair_share(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_showroom_exposure_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showroom_candidates(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_showroom_feed(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_showroom_fair_share(UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_showroom_exposure_report() TO service_role;

-- ── Website traffic fixes ───────────────────────────────────────────────────
-- Sponsors, search, verify-a-buyer and organisation pages were public but
-- never counted. Keep in sync with src/lib/site-visits.ts.
CREATE OR REPLACE FUNCTION public.site_visit_area(p_path TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_path = '/' THEN 'home'
    WHEN p_path = '/mzansi-market' THEN 'mzansi_market'
    WHEN p_path = '/mzansi-business' OR p_path ~* '^/mzansi-business/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'mzansi_business'
    WHEN p_path IN ('/tourism-events', '/promotions', '/promotions/events') OR p_path ~* '^/tourism-events/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'promotions_events'
    WHEN p_path ~* '^/listing/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'shared_listings'
    WHEN p_path = '/sponsors' OR p_path ~ '^/organisation/[a-z0-9][a-z0-9-]{0,80}$' THEN 'organisations'
    WHEN p_path IN ('/pricing', '/advertise', '/contact', '/trust-safety', '/privacy', '/terms', '/paia', '/help/verification', '/help/showroom', '/safety', '/safety/scam-alerts', '/safety/meeting-checklist', '/search', '/verify-buyer') THEN 'other'
    ELSE NULL END;
$$;

-- Staff browsing the site made up a third of all recorded visits.
CREATE OR REPLACE FUNCTION public.record_site_visit(
  p_path TEXT, p_referrer TEXT, p_viewer_key TEXT, p_user_id UUID DEFAULT NULL
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
  IF p_user_id IS NOT NULL AND public.staff_role_of(p_user_id) IS NOT NULL THEN
    RETURN FALSE;
  END IF;

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

-- Stats exclude staff visits already recorded, and now include post views.
CREATE OR REPLACE FUNCTION public.get_site_visit_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
), days AS (
  SELECT to_char(d, 'YYYY-MM-DD') AS date,
    (SELECT count(*) FROM visits v WHERE v.day = d::date) AS visits,
    (SELECT count(DISTINCT v.viewer_key) FROM visits v WHERE v.day = d::date) AS visitors,
    (SELECT count(*) FROM views w WHERE w.day = d::date) AS "postViews"
  FROM bounds b CROSS JOIN LATERAL generate_series(b.today - interval '13 days', b.today, interval '1 day') d
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
$$;

-- ── Fair order for the lists below the showrooms ────────────────────────────
-- "Recommended" (the default list order): posts from the last 72 hours first,
-- then a shuffle that changes every 6 hours. Stable while someone pages
-- through a list, but nobody is stuck at the bottom because they posted early.
-- PostgREST computed fields: .order("fair_rotation_key").
CREATE OR REPLACE FUNCTION public.fair_rotation_key(public.listings)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN COALESCE($1.published_at, $1.created_at) > now() - interval '72 hours' THEN '0' ELSE '1' END
    || md5($1.id::TEXT || ':' || floor(extract(epoch FROM now()) / 21600)::TEXT)
$$;
CREATE OR REPLACE FUNCTION public.fair_rotation_key(public.businesses)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN COALESCE($1.published_at, $1.created_at) > now() - interval '72 hours' THEN '0' ELSE '1' END
    || md5($1.id::TEXT || ':' || floor(extract(epoch FROM now()) / 21600)::TEXT)
$$;
CREATE OR REPLACE FUNCTION public.fair_rotation_key(public.promotions)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN COALESCE($1.published_at, $1.created_at) > now() - interval '72 hours' THEN '0' ELSE '1' END
    || md5($1.id::TEXT || ':' || floor(extract(epoch FROM now()) / 21600)::TEXT)
$$;

-- Public lists sort by it, so signed-out visitors must be able to run it.
GRANT EXECUTE ON FUNCTION public.fair_rotation_key(public.listings) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fair_rotation_key(public.businesses) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fair_rotation_key(public.promotions) TO anon, authenticated, service_role;
