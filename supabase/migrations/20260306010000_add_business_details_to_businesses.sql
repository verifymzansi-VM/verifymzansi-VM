ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS business_details JSONB;
