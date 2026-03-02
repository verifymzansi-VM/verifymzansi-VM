-- Atomic velocity check for KYC artifact uploads.
-- Returns TRUE if the user has fewer than p_max_per_24h artifacts
-- for the given step_type in the past 24 hours.
-- Uses advisory lock to serialize concurrent checks per user+step_type,
-- preventing TOCTOU race conditions in the application-level velocity check.

CREATE OR REPLACE FUNCTION public.check_kyc_velocity(
  p_user_id UUID,
  p_step_type TEXT,
  p_max_per_24h INTEGER DEFAULT 3
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  -- Advisory lock on user+step combo to serialize concurrent checks.
  -- hashtext returns a stable int4 hash; pg_advisory_xact_lock releases
  -- automatically at transaction end.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text || '::' || p_step_type)
  );

  SELECT COUNT(*)
  INTO recent_count
  FROM kyc_artifacts
  WHERE user_id = p_user_id
    AND step_type = p_step_type
    AND created_at >= NOW() - INTERVAL '24 hours';

  RETURN recent_count < p_max_per_24h;
END;
$$;

-- Grant execute to authenticated users (called via service role client in practice)
GRANT EXECUTE ON FUNCTION public.check_kyc_velocity(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_kyc_velocity(UUID, TEXT, INTEGER) TO service_role;
