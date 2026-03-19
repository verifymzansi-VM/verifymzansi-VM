ALTER TABLE public.otp_logs
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS provider_name TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_error TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'otp_logs_delivery_status_check'
  ) THEN
    ALTER TABLE public.otp_logs
      ADD CONSTRAINT otp_logs_delivery_status_check
      CHECK (delivery_status IN ('pending', 'sent', 'failed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_otp_logs_delivery_status_created
  ON public.otp_logs(delivery_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_logs_provider_message_id
  ON public.otp_logs(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
