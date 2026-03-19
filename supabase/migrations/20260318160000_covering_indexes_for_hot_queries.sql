-- Covering composite index for the main businesses directory query.
-- Matches: WHERE status = 'live' AND area = 'MZANSI_BUSINESS'
--          ORDER BY boost_until DESC NULLS LAST, created_at DESC
-- The existing idx_businesses_boost lacks the area equality filter,
-- forcing Postgres to filter after the index scan on every request.
CREATE INDEX IF NOT EXISTS idx_businesses_area_boost_created
  ON businesses (area, boost_until DESC NULLS LAST, created_at DESC)
  WHERE status = 'live';

-- Covering composite index for the main listings marketplace query.
-- Matches: WHERE status = 'live' AND area = 'MZANSI_MARKET'
--          ORDER BY boost_until DESC NULLS LAST, featured DESC, created_at DESC
CREATE INDEX IF NOT EXISTS idx_listings_area_boost_created
  ON listings (area, boost_until DESC NULLS LAST, created_at DESC)
  WHERE status = 'live';

-- Covering composite index for the promotions listing query.
-- Matches: WHERE status = 'live'
--          ORDER BY boost_until DESC NULLS LAST, featured_until DESC NULLS LAST, created_at DESC
CREATE INDEX IF NOT EXISTS idx_promotions_boost_featured_created
  ON promotions (boost_until DESC NULLS LAST, featured_until DESC NULLS LAST, created_at DESC)
  WHERE status = 'live';
