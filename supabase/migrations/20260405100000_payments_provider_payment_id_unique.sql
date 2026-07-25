-- Prevent double-fulfillment from concurrent Ozow webhooks.
-- The app-level claimPaymentProcessing() guard uses optimistic UPDATE + re-read,
-- but two webhooks arriving simultaneously can still race past it.
-- This partial unique index on provider_payment_id ensures the DB rejects
-- a second payment row that claims the same Ozow transaction ID.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_payment_id_unique
  ON payments (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
