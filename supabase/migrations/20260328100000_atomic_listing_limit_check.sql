-- Atomic listing-count guard to prevent TOCTOU race (#25).
-- Acquires a per-user advisory lock, counts active listings, and returns
-- whether the user is under the max_allowed limit.
-- The lock is released automatically at transaction end.
CREATE OR REPLACE FUNCTION public.check_listing_limit(
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
    hashtext(p_user_id::text || '::listing_limit::' || p_area)
  );

  SELECT COUNT(*)
  INTO current_count
  FROM listings
  WHERE owner_id = p_user_id
    AND area = p_area
    AND status <> 'rejected';

  RETURN current_count < p_max_allowed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_listing_limit(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_listing_limit(UUID, TEXT, INTEGER) TO service_role;
