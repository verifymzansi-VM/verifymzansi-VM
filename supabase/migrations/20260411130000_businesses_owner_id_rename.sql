-- Rename legacy businesses.seller_id to businesses.owner_id and keep limit RPC aligned.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'seller_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE public.businesses RENAME COLUMN seller_id TO owner_id;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE relkind = 'i'
      AND relname = 'idx_businesses_seller'
  ) THEN
    ALTER INDEX public.idx_businesses_seller RENAME TO idx_businesses_owner;
  END IF;
END
$$;

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
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text || '::business_limit::' || p_area)
  );

  SELECT COUNT(*)
  INTO current_count
  FROM businesses
  WHERE owner_id = p_user_id
    AND area = p_area
    AND status <> 'rejected';

  RETURN current_count < p_max_allowed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_business_limit(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_business_limit(UUID, TEXT, INTEGER) TO service_role;
