-- The artifact column is an enum, while the RPC parameter is text. PostgreSQL
-- does not implicitly compare them (42883), which blocked every velocity check.
CREATE OR REPLACE FUNCTION public.check_kyc_velocity(
  p_user_id UUID,
  p_step_type TEXT,
  p_max_per_24h INTEGER DEFAULT 3
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recent_count INTEGER;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_user_id::text || '::' || p_step_type)
  );

  SELECT COUNT(*) INTO recent_count
  FROM public.kyc_artifacts
  WHERE user_id = p_user_id
    AND step_type = p_step_type::public.verification_step_type
    AND created_at >= NOW() - INTERVAL '24 hours';

  RETURN recent_count < p_max_per_24h;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_kyc_velocity(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_kyc_velocity(UUID, TEXT, INTEGER) TO service_role;
