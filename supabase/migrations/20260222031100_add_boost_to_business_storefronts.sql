-- Add boost_until column to business_profiles and storefronts tables
-- This enables the boost feature for Business Ads and Mall Shops areas

ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS boost_until TIMESTAMPTZ;
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS boost_until TIMESTAMPTZ;

-- Add indexes for efficient sorting by boost status
CREATE INDEX IF NOT EXISTS idx_business_profiles_boost ON business_profiles(boost_until DESC NULLS LAST) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_storefronts_boost ON storefronts(boost_until DESC NULLS LAST) WHERE status = 'live';
