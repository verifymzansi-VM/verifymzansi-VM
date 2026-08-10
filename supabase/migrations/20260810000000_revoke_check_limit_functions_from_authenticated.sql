-- Security hardening: revoke EXECUTE on check_* limit/velocity functions from
-- anon + authenticated. These SECURITY DEFINER functions accept an arbitrary
-- p_user_id with no ownership check, so any logged-in user could probe other
-- users' KYC artifact counts / listing / business counts (info disclosure and
-- an oracle for enforcement state). All legitimate callers use the service-role
-- admin client, so service_role retains EXECUTE.
--
-- Idempotent: safe to run even if a prior revoke already removed the grant.

-- check_kyc_velocity(UUID, TEXT, INTEGER)
REVOKE EXECUTE ON FUNCTION public.check_kyc_velocity(UUID, TEXT, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_kyc_velocity(UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_kyc_velocity(UUID, TEXT, INTEGER) TO service_role;

-- check_listing_limit(UUID, TEXT, INTEGER)
REVOKE EXECUTE ON FUNCTION public.check_listing_limit(UUID, TEXT, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_listing_limit(UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_listing_limit(UUID, TEXT, INTEGER) TO service_role;

-- check_business_limit(UUID, TEXT, INTEGER)
REVOKE EXECUTE ON FUNCTION public.check_business_limit(UUID, TEXT, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_business_limit(UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_business_limit(UUID, TEXT, INTEGER) TO service_role;
