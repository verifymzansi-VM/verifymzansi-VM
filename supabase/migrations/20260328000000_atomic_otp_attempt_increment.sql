-- Atomic increment for OTP attempt_count to avoid read-modify-write race (#39).
-- Returns the new attempt_count so the caller can decide whether to lock.
CREATE OR REPLACE FUNCTION public.increment_otp_attempt(challenge_id UUID, max_attempts INT, lockout_duration INTERVAL)
RETURNS TABLE(new_attempt_count INT, new_locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count INT;
  v_locked TIMESTAMPTZ;
BEGIN
  UPDATE public.otp_challenges
  SET
    attempt_count = COALESCE(attempt_count, 0) + 1,
    locked_until = CASE
      WHEN COALESCE(attempt_count, 0) + 1 >= max_attempts
      THEN NOW() + lockout_duration
      ELSE locked_until
    END
  WHERE id = challenge_id
    AND verified_at IS NULL
  RETURNING attempt_count, locked_until INTO v_count, v_locked;

  RETURN QUERY SELECT v_count, v_locked;
END;
$$;
