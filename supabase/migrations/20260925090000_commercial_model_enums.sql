-- Commercial model (founding network strategy): enum values only.
-- New enum values cannot be used in the transaction that adds them, so they
-- live in their own migration ahead of 20260925090100_commercial_foundation.
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'sold';
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'suspended';
ALTER TYPE public.listing_status ADD VALUE IF NOT EXISTS 'archived';

-- Retail durations and bulk plans. Old basic/starter/growth/pro stay as legacy.
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'month';
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'half_year';
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'year';
ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'enterprise';

ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'chargeback';
ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'cancelled';
