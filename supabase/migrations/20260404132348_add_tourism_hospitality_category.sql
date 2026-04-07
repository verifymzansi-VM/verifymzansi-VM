-- Add tourism_hospitality to the business_category enum
ALTER TYPE business_category ADD VALUE IF NOT EXISTS 'tourism_hospitality';;
