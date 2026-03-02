-- Add time-limited featured/urgent columns to listings.
-- The existing `featured BOOLEAN` and `urgent BOOLEAN` columns stay for backwards
-- compatibility, but we add expiry timestamps so these add-ons auto-expire like boosts.

-- ── Listings: add featured_until, urgent_until ──
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS urgent_until TIMESTAMPTZ;

-- Auto-set featured/urgent booleans based on expiry timestamps via trigger.
-- This keeps the boolean columns in sync for existing queries that use them.
CREATE OR REPLACE FUNCTION sync_listing_addon_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.featured := (NEW.featured_until IS NOT NULL AND NEW.featured_until > NOW());
  NEW.urgent   := (NEW.urgent_until IS NOT NULL AND NEW.urgent_until > NOW());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listings_sync_addon_flags ON listings;
CREATE TRIGGER listings_sync_addon_flags
  BEFORE INSERT OR UPDATE OF featured_until, urgent_until ON listings
  FOR EACH ROW EXECUTE FUNCTION sync_listing_addon_flags();

-- Index for marketplace sorting: boost → featured → urgent → created_at
CREATE INDEX IF NOT EXISTS idx_listings_promo_sort
  ON listings (boost_until DESC NULLS LAST, featured_until DESC NULLS LAST, urgent_until DESC NULLS LAST, created_at DESC)
  WHERE status = 'live';
