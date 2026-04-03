-- Add composite (area, status, created_at) indexes for businesses and promotions
-- to match the pattern already in place for listings (idx_listings_area_status_created).
-- Speeds up cross-marketplace area filtering and admin/moderation queries.

CREATE INDEX IF NOT EXISTS idx_businesses_area_status_created
ON public.businesses (area, status, created_at DESC);

-- promotions uses promotion_type instead of area
CREATE INDEX IF NOT EXISTS idx_promotions_type_status_created
ON public.promotions (promotion_type, status, created_at DESC);
