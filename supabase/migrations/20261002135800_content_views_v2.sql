-- Content views v2: one counting system for every page that shows a post.
--
-- A "view" follows the industry video standard (MRC/IAB) used by social
-- platforms: the video played for 2 continuous seconds with at least half of
-- the player on screen, or the post's own page was opened. One person counts
-- once per post per 30 minutes, whichever page they saw it on. An "engaged
-- view" is the stricter measure (30 seconds, or 90% of a shorter video).
--
-- The owner's own views and staff views never count. A shared network address
-- (offices, mobile carrier NAT) is capped per post per hour so clearing
-- cookies cannot inflate a count.
--
-- Additive: the legacy listing_views functions keep working until the app is
-- deployed; 20261002130200 retires them afterwards.

CREATE TABLE IF NOT EXISTS public.content_views (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing', 'business', 'promotion')),
  target_id UUID NOT NULL,
  viewer_key TEXT NOT NULL,
  ip_hash TEXT,
  viewer_user_id UUID,
  source TEXT NOT NULL CHECK (source IN ('video', 'page')),
  surface TEXT,
  province TEXT,
  engaged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_views_viewer_recent_idx
  ON public.content_views (target_id, viewer_key, created_at DESC);
CREATE INDEX IF NOT EXISTS content_views_ip_recent_idx
  ON public.content_views (target_id, ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_views_created_idx ON public.content_views (created_at DESC);

ALTER TABLE public.content_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_views FROM anon, authenticated;

ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS engaged_view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS engaged_view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS engaged_view_count INTEGER NOT NULL DEFAULT 0;

-- ── Recording ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_content_views(
  p_events JSONB,
  p_viewer_key TEXT,
  p_ip_hash TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_province TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  e JSONB;
  v_type TEXT;
  v_id UUID;
  v_source TEXT;
  v_engaged BOOLEAN;
  v_owner UUID;
  v_live BOOLEAN;
  v_recent_id BIGINT;
  v_recent_engaged BOOLEAN;
  v_counted JSONB := '[]'::JSONB;
  v_is_staff BOOLEAN := p_user_id IS NOT NULL AND public.staff_role_of(p_user_id) IS NOT NULL;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 20
     OR p_viewer_key IS NULL OR btrim(p_viewer_key) = '' OR length(p_viewer_key) > 200 THEN
    RAISE EXCEPTION 'Invalid view batch';
  END IF;
  IF v_is_staff THEN
    RETURN v_counted;
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    v_type := e->>'type';
    v_source := e->>'source';
    v_engaged := COALESCE((e->>'engaged')::BOOLEAN, FALSE);
    CONTINUE WHEN v_type NOT IN ('listing', 'business', 'promotion')
      OR v_source NOT IN ('video', 'page')
      OR (e->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    v_id := (e->>'id')::UUID;

    -- Only live posts count, and never for their owner.
    IF v_type = 'listing' THEN
      SELECT owner_id, status::TEXT = 'live' INTO v_owner, v_live FROM public.listings WHERE id = v_id;
    ELSIF v_type = 'business' THEN
      SELECT owner_id, status::TEXT = 'live' INTO v_owner, v_live FROM public.businesses WHERE id = v_id;
    ELSE
      SELECT owner_id, status::TEXT = 'live' INTO v_owner, v_live FROM public.promotions WHERE id = v_id;
    END IF;
    CONTINUE WHEN NOT FOUND OR NOT COALESCE(v_live, FALSE)
      OR (p_user_id IS NOT NULL AND v_owner = p_user_id);

    PERFORM pg_advisory_xact_lock(hashtextextended('view:' || v_id::TEXT || ':' || p_viewer_key, 0));

    SELECT id, engaged INTO v_recent_id, v_recent_engaged
      FROM public.content_views
     WHERE target_id = v_id AND viewer_key = p_viewer_key
       AND created_at > now() - interval '30 minutes'
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_recent_id IS NOT NULL THEN
      -- Already counted in this window; an engaged signal upgrades it once.
      IF v_engaged AND NOT v_recent_engaged THEN
        UPDATE public.content_views SET engaged = TRUE WHERE id = v_recent_id;
        IF v_type = 'listing' THEN
          UPDATE public.listings SET engaged_view_count = engaged_view_count + 1 WHERE id = v_id;
        ELSIF v_type = 'business' THEN
          UPDATE public.businesses SET engaged_view_count = engaged_view_count + 1 WHERE id = v_id;
        ELSE
          UPDATE public.promotions SET engaged_view_count = engaged_view_count + 1 WHERE id = v_id;
        END IF;
      END IF;
      CONTINUE;
    END IF;

    -- Invalid-traffic guard: one network address can add at most 60 views
    -- to a post per hour, however many browsers or cleared cookies it uses.
    -- High enough for mobile carrier NAT, where many phones share an address.
    CONTINUE WHEN p_ip_hash IS NOT NULL AND (
      SELECT count(*) FROM public.content_views
       WHERE target_id = v_id AND ip_hash = p_ip_hash
         AND created_at > now() - interval '1 hour'
    ) >= 60;

    INSERT INTO public.content_views
      (target_type, target_id, viewer_key, ip_hash, viewer_user_id, source, surface, province, engaged)
    VALUES
      (v_type, v_id, p_viewer_key, p_ip_hash, p_user_id, v_source,
       left(e->>'surface', 40), left(p_province, 40), v_engaged);

    IF v_type = 'listing' THEN
      UPDATE public.listings SET view_count = COALESCE(view_count, 0) + 1,
        engaged_view_count = engaged_view_count + v_engaged::INT WHERE id = v_id;
    ELSIF v_type = 'business' THEN
      UPDATE public.businesses SET view_count = COALESCE(view_count, 0) + 1,
        engaged_view_count = engaged_view_count + v_engaged::INT WHERE id = v_id;
    ELSE
      UPDATE public.promotions SET view_count = COALESCE(view_count, 0) + 1,
        engaged_view_count = engaged_view_count + v_engaged::INT WHERE id = v_id;
    END IF;

    v_counted := v_counted || to_jsonb(v_id::TEXT);
  END LOOP;

  RETURN v_counted;
END;
$$;

REVOKE ALL ON FUNCTION public.record_content_views(JSONB, TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_content_views(JSONB, TEXT, TEXT, UUID, TEXT)
  TO service_role;

-- ── Reading: counters live on the post rows ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_content_view_counts(p_target_ids UUID[], p_target_type TEXT)
RETURNS TABLE(target_id UUID, view_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH requested AS (
    SELECT DISTINCT UNNEST(COALESCE(p_target_ids, ARRAY[]::UUID[])) AS target_id
  )
  SELECT r.target_id,
    COALESCE(CASE p_target_type
      WHEN 'listing' THEN (SELECT l.view_count FROM public.listings l WHERE l.id = r.target_id)
      WHEN 'business' THEN (SELECT b.view_count FROM public.businesses b WHERE b.id = r.target_id)
      WHEN 'promotion' THEN (SELECT p.view_count FROM public.promotions p WHERE p.id = r.target_id)
    END, 0)::BIGINT
  FROM requested r;
$$;

-- ── Backfill from the legacy counter ────────────────────────────────────────
-- Keep every view people already have. Tourism businesses open at
-- /tourism-events/<id>, and the old tracker filed their views as "promotion"
-- views under the business ID, so they never showed. Credit them back.
WITH legacy AS (
  SELECT lv.target_id,
    CASE
      WHEN lv.target_type = 'promotion'
        AND NOT EXISTS (SELECT 1 FROM public.promotions p WHERE p.id = lv.target_id)
        AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = lv.target_id)
      THEN 'business'
      ELSE lv.target_type
    END AS target_type,
    lv.viewer_key
  FROM public.listing_views lv
  WHERE lv.viewer_key IS NOT NULL
), totals AS (
  SELECT target_type, target_id, count(DISTINCT viewer_key)::INT AS n
  FROM legacy GROUP BY 1, 2
)
UPDATE public.businesses b SET view_count = GREATEST(COALESCE(b.view_count, 0), t.n)
FROM totals t WHERE t.target_type = 'business' AND t.target_id = b.id;

WITH totals AS (
  SELECT target_id, count(DISTINCT viewer_key)::INT AS n
  FROM public.listing_views WHERE target_type = 'listing' AND viewer_key IS NOT NULL GROUP BY 1
)
UPDATE public.listings l SET view_count = GREATEST(COALESCE(l.view_count, 0), t.n)
FROM totals t WHERE t.target_id = l.id;

WITH totals AS (
  SELECT target_id, count(DISTINCT viewer_key)::INT AS n
  FROM public.listing_views WHERE target_type = 'promotion' AND viewer_key IS NOT NULL GROUP BY 1
)
UPDATE public.promotions p SET view_count = GREATEST(COALESCE(p.view_count, 0), t.n)
FROM totals t WHERE t.target_id = p.id;

-- Old video plays that reached 30 seconds were the engaged views.
WITH legacy AS (
  SELECT lv.target_id,
    CASE
      WHEN lv.target_type = 'promotion'
        AND NOT EXISTS (SELECT 1 FROM public.promotions p WHERE p.id = lv.target_id)
      THEN 'business' ELSE lv.target_type
    END AS target_type
  FROM public.listing_views lv
  WHERE lv.viewer_key LIKE '%#playback:%'
), totals AS (SELECT target_type, target_id, count(*)::INT AS n FROM legacy GROUP BY 1, 2)
UPDATE public.businesses b SET engaged_view_count = GREATEST(b.engaged_view_count, t.n)
FROM totals t WHERE t.target_type = 'business' AND t.target_id = b.id;

UPDATE public.listings l SET engaged_view_count = GREATEST(l.engaged_view_count, t.n)
FROM (SELECT target_id, count(*)::INT AS n FROM public.listing_views
      WHERE target_type = 'listing' AND viewer_key LIKE '%#playback:%' GROUP BY 1) t
WHERE t.target_id = l.id;

UPDATE public.promotions p SET engaged_view_count = GREATEST(p.engaged_view_count, t.n)
FROM (SELECT target_id, count(*)::INT AS n FROM public.listing_views
      WHERE target_type = 'promotion' AND viewer_key LIKE '%#playback:%' GROUP BY 1) t
WHERE t.target_id = p.id;

-- ── Retention ───────────────────────────────────────────────────────────────
-- Raw view rows exist for the 30-minute repeat check, the per-network cap and
-- the 30-day admin charts; totals live on the post rows and never shrink.
-- (The legacy counter was computed FROM its raw rows, so its 90-day purge
-- would have made every post's view count fall over time.)
SELECT cron.schedule(
  'retention_content_views_90d',
  '42 2 * * *',
  $$DELETE FROM public.content_views WHERE created_at < now() - interval '90 days'$$
);
