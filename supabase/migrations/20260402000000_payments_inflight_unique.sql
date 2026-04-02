-- Prevent TOCTOU race in create-checkout: two concurrent requests could both
-- pass the "no pending payment" SELECT check and insert duplicate in-flight
-- rows.  This partial unique index enforces at most one pending/processing
-- payment per user+area at the database level.

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_inflight_unique
  ON public.payments (user_id, area)
  WHERE status IN ('pending', 'processing');
