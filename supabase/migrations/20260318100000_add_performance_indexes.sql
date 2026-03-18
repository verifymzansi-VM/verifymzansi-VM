-- Partial index for fast middleware suspension checks.
-- Covers: WHERE account_status = 'suspended' queries that run on every request.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seller_profiles_suspended_active
  ON seller_profiles (user_id)
  WHERE account_status = 'suspended';

-- Composite index for the main marketplace listing query:
-- SELECT ... FROM listings WHERE marketplace_area = ? AND status = 'live' ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_area_status_created
  ON listings (marketplace_area, status, created_at DESC);

-- Index for phone verification status lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_verification_steps_phone_verified
  ON verification_steps (user_id, phone_verified_at)
  WHERE phone_verified_at IS NOT NULL;
