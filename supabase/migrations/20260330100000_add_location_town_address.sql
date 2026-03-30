-- Add location_town and location_address columns to listings, businesses, and promotions.
-- verification_steps already has location_town + location_address_line.

-- ── listings: address column (town already stored in location_suburb) ──
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS location_address text;

-- ── businesses: town + address columns ──
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS location_town text,
  ADD COLUMN IF NOT EXISTS location_address text;

-- ── promotions: town + address columns ──
ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS location_town text,
  ADD COLUMN IF NOT EXISTS location_address text;
