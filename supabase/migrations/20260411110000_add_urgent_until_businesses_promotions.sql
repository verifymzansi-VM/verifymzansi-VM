-- Add urgent_until column to businesses and promotions tables.
-- Mirrors the pattern used for boost_until and featured_until.

-- ── Businesses: add urgent_until ──
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS urgent_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_businesses_urgent
  ON businesses (urgent_until DESC NULLS LAST)
  WHERE urgent_until IS NOT NULL;

-- Update the covering sort index to include urgent_until
DROP INDEX IF EXISTS idx_businesses_area_boost_created;
CREATE INDEX idx_businesses_area_boost_created
  ON businesses (area, boost_until DESC NULLS LAST, featured_until DESC NULLS LAST, urgent_until DESC NULLS LAST, created_at DESC)
  WHERE status = 'live';

-- ── Promotions: add urgent_until ──
ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS urgent_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_promotions_urgent
  ON promotions (urgent_until DESC NULLS LAST)
  WHERE urgent_until IS NOT NULL;

-- Update the covering sort index to include urgent_until
DROP INDEX IF EXISTS idx_promotions_boost_featured_created;
CREATE INDEX idx_promotions_boost_featured_created
  ON promotions (boost_until DESC NULLS LAST, featured_until DESC NULLS LAST, urgent_until DESC NULLS LAST, created_at DESC)
  WHERE status = 'live';
