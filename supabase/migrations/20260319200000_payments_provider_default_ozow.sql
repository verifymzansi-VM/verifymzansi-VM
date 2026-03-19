-- Change the default provider for new payments from 'payfast' (legacy) to 'ozow' (active provider).
-- Does NOT change existing rows — only affects new inserts that don't specify a provider.
ALTER TABLE public.payments ALTER COLUMN provider SET DEFAULT 'ozow';
