-- Atomic increment for promotion view_count to avoid read-modify-write race.
CREATE OR REPLACE FUNCTION public.increment_promotion_view_count(promotion_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE promotions
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = promotion_id;
$$;
