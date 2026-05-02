-- Atomic promotion-count guard to prevent TOCTOU race.
-- Acquires a per-user advisory lock and counts active standalone promotions,
-- and returns whether the user is under the max_allowed limit.
-- The lock is released automatically at transaction end.
CREATE OR REPLACE FUNCTION public.check_promotion_limit(
  p_user_id UUID,
  p_area TEXT,
  p_max_allowed INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text || '::promotion_limit::' || p_area)
  );

  SELECT COUNT(*)
  INTO current_count
  FROM promotions
  WHERE owner_id = p_user_id
    AND status <> 'rejected';

  RETURN current_count < p_max_allowed;
END;
$$;

REVOKE ALL ON FUNCTION public.check_promotion_limit(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_promotion_limit(UUID, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.check_promotion_limit(UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_promotion_limit(UUID, TEXT, INTEGER) TO service_role;
