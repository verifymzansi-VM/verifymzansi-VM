DO $$
BEGIN
  IF to_regclass('public.malls') IS NOT NULL THEN
    UPDATE public.businesses AS b
    SET business_details = jsonb_strip_nulls(
      COALESCE(b.business_details, '{}'::jsonb) ||
      jsonb_build_object(
        'type', 'mall_store',
        'mall_name',
          COALESCE(
            NULLIF(BTRIM(COALESCE(b.business_details ->> 'mall_name', '')), ''),
            m.name
          ),
        'mall_photos',
          COALESCE(
            CASE
              WHEN jsonb_typeof(COALESCE(b.business_details, '{}'::jsonb) -> 'mall_photos') = 'array'
                THEN COALESCE(b.business_details, '{}'::jsonb) -> 'mall_photos'
            END,
            '[]'::jsonb
          )
      )
    )
    FROM public.malls AS m
    WHERE b.business_type = 'mall_store'::business_type
      AND b.mall_id = m.id;
  END IF;

  UPDATE public.businesses AS b
  SET business_details = jsonb_strip_nulls(
    COALESCE(b.business_details, '{}'::jsonb) ||
    jsonb_build_object(
      'type', 'mall_store',
      'mall_photos',
        COALESCE(
          CASE
            WHEN jsonb_typeof(COALESCE(b.business_details, '{}'::jsonb) -> 'mall_photos') = 'array'
              THEN COALESCE(b.business_details, '{}'::jsonb) -> 'mall_photos'
          END,
          '[]'::jsonb
        )
    )
  )
  WHERE b.business_type = 'mall_store'::business_type;
END $$;
DROP INDEX IF EXISTS public.idx_businesses_mall;
ALTER TABLE public.businesses DROP COLUMN IF EXISTS mall_id;
DROP INDEX IF EXISTS public.idx_storefronts_mall_id;
ALTER TABLE public.storefronts DROP COLUMN IF EXISTS mall_id;
DROP TABLE IF EXISTS public.malls;
