-- Atomic business-count guard to prevent TOCTOU race.
-- Acquires a per-user advisory lock, counts active businesses for the area,
-- and returns whether the user is under the max_allowed limit.
-- The lock is released automatically at transaction end.
CREATE OR REPLACE FUNCTION public.check_business_limit(
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
  owner_column TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text || '::business_limit::' || p_area)
  );

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'owner_id'
  ) THEN
    owner_column := 'owner_id';
  ELSE
    owner_column := 'seller_id';
  END IF;

  EXECUTE format(
    'SELECT COUNT(*) FROM businesses WHERE %I = $1 AND area = $2 AND status <> ''rejected''',
    owner_column
  )
  INTO current_count
  USING p_user_id, p_area;

  RETURN current_count < p_max_allowed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_business_limit(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_business_limit(UUID, TEXT, INTEGER) TO service_role;
