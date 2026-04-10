-- Align businesses table with media metadata fields consumed by API and UI.
-- These columns were previously added to business_profiles, but runtime reads businesses.*.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS media_width integer,
  ADD COLUMN IF NOT EXISTS media_height integer,
  ADD COLUMN IF NOT EXISTS focal_x real DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS focal_y real DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS blurhash text;

COMMENT ON COLUMN public.businesses.media_width IS 'Primary media width in pixels (captured client-side at upload)';
COMMENT ON COLUMN public.businesses.media_height IS 'Primary media height in pixels (captured client-side at upload)';
COMMENT ON COLUMN public.businesses.focal_x IS 'Horizontal focal point 0..1 (0 = left, 1 = right, 0.5 = centre)';
COMMENT ON COLUMN public.businesses.focal_y IS 'Vertical focal point 0..1 (0 = top, 1 = bottom, 0.5 = centre)';
COMMENT ON COLUMN public.businesses.blurhash IS 'BlurHash LQIP string computed client-side at image upload (4x3 components)';
