-- Media dimensions & focal point metadata
-- Enables CLS prevention (server-known aspect ratio) and focal-point-aware cropping.

-- ── Listings ─────────────────────────────────────────────
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS media_width  integer,
  ADD COLUMN IF NOT EXISTS media_height integer,
  ADD COLUMN IF NOT EXISTS focal_x      real DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS focal_y      real DEFAULT 0.5;

COMMENT ON COLUMN public.listings.media_width  IS 'Primary media width in pixels (captured client-side at upload)';
COMMENT ON COLUMN public.listings.media_height IS 'Primary media height in pixels (captured client-side at upload)';
COMMENT ON COLUMN public.listings.focal_x      IS 'Horizontal focal point 0..1 (0 = left, 1 = right, 0.5 = centre)';
COMMENT ON COLUMN public.listings.focal_y      IS 'Vertical focal point 0..1 (0 = top, 1 = bottom, 0.5 = centre)';

-- ── Business profiles ────────────────────────────────────
ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS media_width  integer,
  ADD COLUMN IF NOT EXISTS media_height integer,
  ADD COLUMN IF NOT EXISTS focal_x      real DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS focal_y      real DEFAULT 0.5;

-- ── Promotions ───────────────────────────────────────────
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS media_width  integer,
  ADD COLUMN IF NOT EXISTS media_height integer,
  ADD COLUMN IF NOT EXISTS focal_x      real DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS focal_y      real DEFAULT 0.5;
