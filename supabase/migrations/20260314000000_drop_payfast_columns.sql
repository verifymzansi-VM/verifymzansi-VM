-- Remove legacy PayFast columns now that all data has been migrated
-- to provider-neutral fields (see 20260313130000_ozow_provider_neutral_payments.sql).

-- 1. Normalize historical payments to 'ozow' provider
--    (provider_data already contains the original PayFast ITN data)
UPDATE public.payments SET provider = 'ozow' WHERE provider = 'payfast';
-- 2. Drop legacy PayFast columns from payments table
ALTER TABLE public.payments
  DROP COLUMN IF EXISTS payfast_payment_id,
  DROP COLUMN IF EXISTS payfast_data;
-- 3. Drop legacy PayFast subscription ID from entitlements table
ALTER TABLE public.entitlements
  DROP COLUMN IF EXISTS payfast_subscription_id;
-- 4. Default new payments to 'ozow'
ALTER TABLE public.payments
  ALTER COLUMN provider SET DEFAULT 'ozow';
-- 5. Enforce ozow-only going forward
ALTER TABLE public.payments
  ADD CONSTRAINT payments_provider_ozow_only CHECK (provider = 'ozow');
