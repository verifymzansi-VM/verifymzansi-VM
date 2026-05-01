-- Keep denormalized owner-facing view counters in sync for every content area.
-- The canonical unique-view log remains listing_views; these counters provide
-- resilient dashboard/profile fallbacks when summary RPC reads are unavailable.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS view_count INTEGER;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS view_count INTEGER;

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS view_count INTEGER;

WITH aggregated AS (
  SELECT
    listing_views.target_id,
    COUNT(DISTINCT listing_views.viewer_key)::INTEGER AS view_count
  FROM public.listing_views
  WHERE listing_views.target_type = 'listing'
    AND listing_views.viewer_key IS NOT NULL
  GROUP BY listing_views.target_id
)
UPDATE public.listings
SET view_count = GREATEST(COALESCE(listings.view_count, 0), aggregated.view_count)
FROM aggregated
WHERE listings.id = aggregated.target_id;

WITH aggregated AS (
  SELECT
    listing_views.target_id,
    COUNT(DISTINCT listing_views.viewer_key)::INTEGER AS view_count
  FROM public.listing_views
  WHERE listing_views.target_type = 'business'
    AND listing_views.viewer_key IS NOT NULL
  GROUP BY listing_views.target_id
)
UPDATE public.businesses
SET view_count = GREATEST(COALESCE(businesses.view_count, 0), aggregated.view_count)
FROM aggregated
WHERE businesses.id = aggregated.target_id;

WITH aggregated AS (
  SELECT
    listing_views.target_id,
    COUNT(DISTINCT listing_views.viewer_key)::INTEGER AS view_count
  FROM public.listing_views
  WHERE listing_views.target_type = 'promotion'
    AND listing_views.viewer_key IS NOT NULL
  GROUP BY listing_views.target_id
)
UPDATE public.promotions
SET view_count = GREATEST(COALESCE(promotions.view_count, 0), aggregated.view_count)
FROM aggregated
WHERE promotions.id = aggregated.target_id;

UPDATE public.listings
SET view_count = 0
WHERE view_count IS NULL;

UPDATE public.businesses
SET view_count = 0
WHERE view_count IS NULL;

UPDATE public.promotions
SET view_count = 0
WHERE view_count IS NULL;

ALTER TABLE public.listings
  ALTER COLUMN view_count SET DEFAULT 0,
  ALTER COLUMN view_count SET NOT NULL;

ALTER TABLE public.businesses
  ALTER COLUMN view_count SET DEFAULT 0,
  ALTER COLUMN view_count SET NOT NULL;

ALTER TABLE public.promotions
  ALTER COLUMN view_count SET DEFAULT 0,
  ALTER COLUMN view_count SET NOT NULL;

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

  IF inserted_row_count > 0 THEN
    IF p_target_type = 'listing' THEN
      UPDATE public.listings
      SET view_count = COALESCE(view_count, 0) + 1
      WHERE id = p_target_id;
    ELSIF p_target_type = 'business' THEN
      UPDATE public.businesses
      SET view_count = COALESCE(view_count, 0) + 1
      WHERE id = p_target_id;
    ELSIF p_target_type = 'promotion' THEN
      UPDATE public.promotions
      SET view_count = COALESCE(view_count, 0) + 1
      WHERE id = p_target_id;
    END IF;
  END IF;

  RETURN inserted_row_count > 0;
END;
$$;
