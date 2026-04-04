-- Add subcategory and category_details columns to businesses table
-- subcategory: free-text field validated at the application layer (too many values for an enum)
-- category_details: JSONB for category-specific fields (practice_number, brands_serviced, etc.)

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS category_details jsonb NOT NULL DEFAULT '{}';

-- Also add building_name and suite_or_unit for the relabeled standalone_shop ("Own Premises") type
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS building_name text,
  ADD COLUMN IF NOT EXISTS suite_or_unit text;

COMMENT ON COLUMN businesses.subcategory IS 'Fine-grained business subcategory within the parent category (e.g. "mechanic_workshop" under automotive_transport)';
COMMENT ON COLUMN businesses.category_details IS 'Category-specific structured fields (practice_number, brands_serviced, etc.)';
COMMENT ON COLUMN businesses.building_name IS 'Building or complex name for own-premises businesses';
COMMENT ON COLUMN businesses.suite_or_unit IS 'Suite, unit, or office number within a building';
