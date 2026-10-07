-- Roll back the read half of private_post_columns: the showroom feeds order by
-- the computed field fair_rotation_key(row), and a whole-row reference needs
-- SELECT on every column, so column-level grants broke every marketplace grid.
-- Table SELECT is restored until the feeds stop using a whole-row function.
-- The DELETE/UPDATE revokes from private_post_columns stay in place.
GRANT SELECT ON public.businesses, public.listings TO anon, authenticated;
