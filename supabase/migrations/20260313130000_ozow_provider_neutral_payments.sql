-- Add provider-neutral payment fields to support Ozow and preserve PayFast history.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'payment_status'
      AND e.enumlabel = 'processing'
  ) THEN
    ALTER TYPE payment_status ADD VALUE 'processing' AFTER 'pending';
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'payment_status'
      AND e.enumlabel = 'expired'
  ) THEN
    ALTER TYPE payment_status ADD VALUE 'expired' AFTER 'failed';
  END IF;
END $$;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS provider_data JSONB;
UPDATE public.payments
SET
  provider = COALESCE(provider, 'payfast'),
  provider_payment_id = COALESCE(provider_payment_id, payfast_payment_id),
  provider_reference = COALESCE(provider_reference, id::text),
  provider_data = COALESCE(provider_data, payfast_data)
WHERE
  provider IS NULL
  OR provider_payment_id IS NULL
  OR provider_reference IS NULL
  OR provider_data IS NULL;
ALTER TABLE public.payments
  ALTER COLUMN provider SET DEFAULT 'payfast',
  ALTER COLUMN provider SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_reference
ON public.payments(provider, provider_reference)
WHERE provider_reference IS NOT NULL;
