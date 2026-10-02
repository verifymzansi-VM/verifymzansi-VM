-- Local-first must not override fairness. A province with few posts (e.g. 2
-- in Gauteng, where most visitors are) would otherwise put the same local
-- posts at the front for every local visitor. A local post already shown more
-- than twice its fair share this week is reported as over-exposed; the app
-- then treats it as a national post, so it waits its turn like everyone else.
-- Adds a column, so the function is recreated (old app code ignores it).
DROP FUNCTION IF EXISTS public.get_showroom_feed(TEXT, TEXT, INTEGER);

CREATE FUNCTION public.get_showroom_feed(
  p_surface TEXT,
  p_province TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE(content_table TEXT, content_id UUID, is_local BOOLEAN, is_new BOOLEAN,
  over_exposed BOOLEAN)
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
      j.shown >= 3 AND j.shown > 2 * f.share AS over_exposed,
      (f.share - j.shown) / f.share
        + CASE WHEN j.is_new THEN 1 ELSE 0 END
        + CASE WHEN j.has_video THEN 0.15 ELSE 0 END
        + random() * 0.3 AS score
    FROM joined j CROSS JOIN fair f
  ), ranked AS (
    SELECT s.*, row_number() OVER (PARTITION BY s.is_local ORDER BY s.score DESC) AS rn
    FROM scored s
  )
  SELECT content_table, content_id, is_local, is_new, over_exposed
  FROM ranked
  WHERE rn <= LEAST(GREATEST(p_limit, 1), 100)
  ORDER BY score DESC;
$$;

REVOKE ALL ON FUNCTION public.get_showroom_feed(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_showroom_feed(TEXT, TEXT, INTEGER) TO service_role;
