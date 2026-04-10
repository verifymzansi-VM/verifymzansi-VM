-- Tourism & Events enrichment migration
-- Adds event_details JSONB to promotions table and prepares for
-- tourism businesses to live under the PROMOTIONS_EVENTS area.

-- 1. Add event_details JSONB to promotions
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS event_details JSONB;

-- 2. Composite index for tourism businesses by area + category
CREATE INDEX IF NOT EXISTS idx_businesses_tourism
  ON businesses (area, category)
  WHERE category = 'tourism_hospitality';

-- 3. Move existing tourism businesses to PROMOTIONS_EVENTS area
UPDATE businesses
SET area = 'PROMOTIONS_EVENTS'
WHERE category = 'tourism_hospitality'
  AND area = 'MZANSI_BUSINESS';
