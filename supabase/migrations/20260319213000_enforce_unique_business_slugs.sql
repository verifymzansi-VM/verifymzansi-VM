UPDATE public.businesses
SET slug = NULLIF(lower(btrim(slug)), '')
WHERE slug IS NOT NULL
  AND slug IS DISTINCT FROM NULLIF(lower(btrim(slug)), '');

DO $$
DECLARE
  conflicting_slug TEXT;
  conflicting_count INTEGER;
BEGIN
  SELECT normalized_slug, COUNT(*)::INTEGER
  INTO conflicting_slug, conflicting_count
  FROM (
    SELECT lower(btrim(slug)) AS normalized_slug
    FROM public.businesses
    WHERE NULLIF(btrim(slug), '') IS NOT NULL
  ) normalized_businesses
  GROUP BY normalized_slug
  HAVING COUNT(*) > 1
  ORDER BY normalized_slug
  LIMIT 1;

  IF conflicting_slug IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce unique business slugs while duplicates exist: % (% rows)',
      conflicting_slug,
      conflicting_count
      USING ERRCODE = '23505',
            CONSTRAINT = 'idx_businesses_slug_unique';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_slug_unique
ON public.businesses ((lower(slug)))
WHERE slug IS NOT NULL;