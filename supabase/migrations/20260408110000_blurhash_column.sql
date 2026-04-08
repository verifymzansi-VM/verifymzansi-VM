-- BlurHash LQIP placeholders
-- Stores a compact BlurHash string (~20-30 chars) computed client-side at upload.
-- Used to render a blurred colour placeholder while the real image loads.

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS blurhash text;

COMMENT ON COLUMN public.listings.blurhash IS 'BlurHash LQIP string computed client-side at image upload (4×3 components)';

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS blurhash text;

COMMENT ON COLUMN public.business_profiles.blurhash IS 'BlurHash LQIP string computed client-side at image upload (4×3 components)';

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS blurhash text;

COMMENT ON COLUMN public.promotions.blurhash IS 'BlurHash LQIP string computed client-side at image upload (4×3 components)';
