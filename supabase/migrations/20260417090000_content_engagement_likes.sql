-- Shared engagement primitives for marketplace cards.
-- Adds persisted likes and reusable helper functions for like/view summaries.

CREATE TABLE IF NOT EXISTS public.content_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing', 'promotion', 'business')),
  viewer_key TEXT NOT NULL,
  viewer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (target_id, target_type, viewer_key)
);

CREATE INDEX IF NOT EXISTS idx_content_likes_target
  ON public.content_likes (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_content_likes_viewer
  ON public.content_likes (viewer_user_id, target_type, created_at DESC)
  WHERE viewer_user_id IS NOT NULL;

ALTER TABLE public.content_likes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.listing_views
  ADD COLUMN IF NOT EXISTS viewer_key TEXT;

ALTER TABLE public.listing_views DROP CONSTRAINT IF EXISTS listing_views_target_type_check;

ALTER TABLE public.listing_views
  ADD CONSTRAINT listing_views_target_type_check
  CHECK (target_type IN ('listing', 'storefront', 'business_profile', 'business', 'promotion'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_views_target_viewer
  ON public.listing_views (target_id, target_type, viewer_key)
  WHERE viewer_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_content_view(
  p_target_id UUID,
  p_target_type TEXT,
  p_viewer_key TEXT,
  p_viewer_user_id UUID DEFAULT NULL,
  p_viewer_ip_hash TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_row_count INTEGER := 0;
BEGIN
  IF p_target_type NOT IN ('listing', 'promotion', 'business') THEN
    RAISE EXCEPTION 'Unsupported target_type: %', p_target_type;
  END IF;

  IF p_viewer_key IS NULL OR btrim(p_viewer_key) = '' THEN
    RAISE EXCEPTION 'viewer_key is required';
  END IF;

  INSERT INTO public.listing_views (
    target_id,
    target_type,
    viewer_key,
    viewer_user_id,
    viewer_ip_hash
  )
  VALUES (
    p_target_id,
    p_target_type,
    p_viewer_key,
    p_viewer_user_id,
    p_viewer_ip_hash
  )
  ON CONFLICT (target_id, target_type, viewer_key)
    WHERE viewer_key IS NOT NULL
    DO NOTHING;

  GET DIAGNOSTICS inserted_row_count = ROW_COUNT;

  IF inserted_row_count > 0 AND p_target_type = 'promotion' THEN
    UPDATE public.promotions
    SET view_count = COALESCE(view_count, 0) + 1
    WHERE id = p_target_id;
  END IF;

  RETURN inserted_row_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_content_view_counts(
  p_target_ids UUID[],
  p_target_type TEXT
)
RETURNS TABLE (
  target_id UUID,
  view_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested AS (
    SELECT UNNEST(COALESCE(p_target_ids, ARRAY[]::UUID[])) AS target_id
  ),
  aggregated AS (
    SELECT
      listing_views.target_id,
      COUNT(DISTINCT listing_views.viewer_key)::BIGINT AS view_count
    FROM public.listing_views
    WHERE listing_views.target_type = p_target_type
      AND listing_views.viewer_key IS NOT NULL
      AND listing_views.target_id = ANY(COALESCE(p_target_ids, ARRAY[]::UUID[]))
    GROUP BY listing_views.target_id
  )
  SELECT
    requested.target_id,
    COALESCE(aggregated.view_count, 0)::BIGINT AS view_count
  FROM requested
  LEFT JOIN aggregated USING (target_id);
$$;

CREATE OR REPLACE FUNCTION public.get_content_like_summary(
  p_target_ids UUID[],
  p_target_type TEXT,
  p_viewer_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  target_id UUID,
  like_count BIGINT,
  viewer_has_liked BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested AS (
    SELECT UNNEST(COALESCE(p_target_ids, ARRAY[]::UUID[])) AS target_id
  ),
  aggregated AS (
    SELECT
      content_likes.target_id,
      COUNT(*)::BIGINT AS like_count
    FROM public.content_likes
    WHERE content_likes.target_type = p_target_type
      AND content_likes.target_id = ANY(COALESCE(p_target_ids, ARRAY[]::UUID[]))
    GROUP BY content_likes.target_id
  ),
  viewer_matches AS (
    SELECT
      content_likes.target_id,
      TRUE AS viewer_has_liked
    FROM public.content_likes
    WHERE p_viewer_key IS NOT NULL
      AND content_likes.target_type = p_target_type
      AND content_likes.viewer_key = p_viewer_key
      AND content_likes.target_id = ANY(COALESCE(p_target_ids, ARRAY[]::UUID[]))
    GROUP BY content_likes.target_id
  )
  SELECT
    requested.target_id,
    COALESCE(aggregated.like_count, 0)::BIGINT AS like_count,
    COALESCE(viewer_matches.viewer_has_liked, FALSE) AS viewer_has_liked
  FROM requested
  LEFT JOIN aggregated USING (target_id)
  LEFT JOIN viewer_matches USING (target_id);
$$;

CREATE OR REPLACE FUNCTION public.toggle_content_like(
  p_target_id UUID,
  p_target_type TEXT,
  p_viewer_key TEXT,
  p_viewer_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  liked BOOLEAN,
  like_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_like_id UUID;
BEGIN
  IF p_target_type NOT IN ('listing', 'promotion', 'business') THEN
    RAISE EXCEPTION 'Unsupported target_type: %', p_target_type;
  END IF;

  IF p_viewer_key IS NULL OR btrim(p_viewer_key) = '' THEN
    RAISE EXCEPTION 'viewer_key is required';
  END IF;

  SELECT id
  INTO existing_like_id
  FROM public.content_likes
  WHERE target_id = p_target_id
    AND target_type = p_target_type
    AND viewer_key = p_viewer_key
  LIMIT 1;

  IF existing_like_id IS NULL THEN
    INSERT INTO public.content_likes (
      target_id,
      target_type,
      viewer_key,
      viewer_user_id
    )
    VALUES (
      p_target_id,
      p_target_type,
      p_viewer_key,
      p_viewer_user_id
    );

    liked := TRUE;
  ELSE
    DELETE FROM public.content_likes
    WHERE id = existing_like_id;

    liked := FALSE;
  END IF;

  SELECT COUNT(*)::BIGINT
  INTO like_count
  FROM public.content_likes
  WHERE target_id = p_target_id
    AND target_type = p_target_type;

  RETURN NEXT;
END;
$$;
