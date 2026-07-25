DO $$
BEGIN
  IF to_regclass('public.malls') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'businesses'
        AND column_name = 'mall_id'
    )
  THEN
    UPDATE public.businesses AS b
    SET business_details = jsonb_strip_nulls(
      COALESCE(b.business_details, '{}'::jsonb) ||
      jsonb_build_object(
        'mall_name',
        COALESCE(
          NULLIF(BTRIM(COALESCE(b.business_details ->> 'mall_name', '')), ''),
          m.name
        )
      )
    )
    FROM public.malls AS m
    WHERE b.mall_id = m.id;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_businesses_mall;
ALTER TABLE public.businesses DROP COLUMN IF EXISTS mall_id;
DROP INDEX IF EXISTS public.idx_storefronts_mall_id;
ALTER TABLE public.storefronts DROP COLUMN IF EXISTS mall_id;
DROP TABLE IF EXISTS public.malls;
