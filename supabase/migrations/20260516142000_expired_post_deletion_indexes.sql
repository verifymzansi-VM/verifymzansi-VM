-- Speed up the retention worker sweep that permanently deletes posts
-- two days after their visibility window has expired.

CREATE INDEX IF NOT EXISTS idx_listings_expired_delete
  ON public.listings (expires_at)
  WHERE status = 'expired' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_expired_delete
  ON public.businesses (expires_at)
  WHERE status = 'expired' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promotions_expired_delete
  ON public.promotions (expires_at)
  WHERE status = 'expired' AND expires_at IS NOT NULL;
