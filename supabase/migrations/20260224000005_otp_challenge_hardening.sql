-- Harden OTP challenge flow with user-bound challenge state and lockout tracking.

CREATE TABLE IF NOT EXISTS public.otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_user_phone_created
  ON public.otp_challenges(user_id, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_expires
  ON public.otp_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_locked_until
  ON public.otp_challenges(locked_until)
  WHERE locked_until IS NOT NULL;
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on otp_challenges"
  ON public.otp_challenges;
CREATE POLICY "Service role full access on otp_challenges"
  ON public.otp_challenges
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "Admin reads otp challenges"
  ON public.otp_challenges;
CREATE POLICY "Admin reads otp challenges"
  ON public.otp_challenges
  FOR SELECT
  USING (public.has_role('admin'));
