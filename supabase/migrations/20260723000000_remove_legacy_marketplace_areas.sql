-- ============================================================
-- Remove Legacy Marketplace Areas (Business Ads + Mall Shops)
--
-- The platform now has exactly three marketplace areas:
--   MZANSI_MARKET · MZANSI_BUSINESS · PROMOTIONS_EVENTS
--
-- This migration:
--   1. Deletes deactivated legacy plans (UNIQUE(area,tier) would
--      otherwise collide when the enum is recreated).
--   2. Remaps any remaining legacy area values to MZANSI_BUSINESS.
--   3. Drops legacy tables (storefronts, business_profiles,
--      business_posts, storefront_posts, malls). All live data was
--      already unified into `businesses` / `promotions` by
--      20260304000000_unified_businesses_table.sql.
--   4. Recreates the marketplace_area enum with only the three
--      active values, preserving every column that uses it.
--   5. Recreates the free-post ledger functions without legacy
--      branches.
-- ============================================================

-- ── 1. Remove legacy plans ──────────────────────────────────

DELETE FROM public.plans
WHERE area IN ('MALL_SHOPS'::marketplace_area, 'BUSINESS_ADS'::marketplace_area);

-- ── 2. Remap remaining legacy area values ───────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT c.table_schema, c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.udt_name = 'marketplace_area'
      AND c.table_name <> 'plans'
  ) LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = ''MZANSI_BUSINESS''::marketplace_area
       WHERE %I IN (''MALL_SHOPS''::marketplace_area, ''BUSINESS_ADS''::marketplace_area)',
      r.table_schema, r.table_name, r.column_name, r.column_name
    );
  END LOOP;
END $$;

-- ── 3. Drop enum-dependent free-post functions ──────────────

DROP FUNCTION IF EXISTS public.free_post_area_has_any_content(UUID, marketplace_area);
DROP FUNCTION IF EXISTS public.free_post_content_exists(UUID, marketplace_area, UUID);
DROP FUNCTION IF EXISTS public.claim_free_post_slot(UUID, marketplace_area, UUID, INTEGER);

-- ── 4. Drop legacy tables ───────────────────────────────────

DROP TABLE IF EXISTS public.business_posts;
DROP TABLE IF EXISTS public.storefront_posts;
DROP TABLE IF EXISTS public.storefronts;
DROP TABLE IF EXISTS public.business_profiles;
DROP TABLE IF EXISTS public.malls;

-- ── 5. Recreate marketplace_area enum ───────────────────────

CREATE TYPE public.marketplace_area_new AS ENUM (
  'MZANSI_MARKET',
  'MZANSI_BUSINESS',
  'PROMOTIONS_EVENTS'
);

DO $$
DECLARE
  r RECORD;
  new_default TEXT;
BEGIN
  FOR r IN (
    SELECT c.table_schema, c.table_name, c.column_name, c.column_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.udt_name = 'marketplace_area'
  ) LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
      r.table_schema, r.table_name, r.column_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE public.marketplace_area_new
       USING %I::text::public.marketplace_area_new',
      r.table_schema, r.table_name, r.column_name, r.column_name
    );
    IF r.column_default IS NOT NULL THEN
      -- Strip any cast decoration from the old default expression,
      -- then re-apply it against the new enum type.
      new_default := regexp_replace(r.column_default, '::\s*public\.?\s*marketplace_area', '', 'g');
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s::public.marketplace_area_new',
        r.table_schema, r.table_name, r.column_name, new_default
      );
    END IF;
  END LOOP;
END $$;

DROP TYPE public.marketplace_area;
ALTER TYPE public.marketplace_area_new RENAME TO marketplace_area;

-- ── 6. Recreate free-post ledger functions ──────────────────

CREATE OR REPLACE FUNCTION public.free_post_content_exists(
  p_user_id UUID,
  p_area marketplace_area,
  p_content_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  owner_column TEXT;
  content_exists BOOLEAN := FALSE;
BEGIN
  IF p_content_id IS NULL THEN
    RETURN FALSE;
  END IF;

  CASE p_area
    WHEN 'MZANSI_MARKET' THEN
      IF to_regclass('public.listings') IS NULL THEN
        RETURN FALSE;
      END IF;

      owner_column := CASE
        WHEN public.free_post_owner_column_exists('listings', 'owner_id') THEN 'owner_id'
        WHEN public.free_post_owner_column_exists('listings', 'seller_id') THEN 'seller_id'
        ELSE NULL
      END;

      IF owner_column IS NULL THEN
        RETURN FALSE;
      END IF;

      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM public.listings
           WHERE id = $1
             AND area = $2
             AND %I = $3
         )',
        owner_column
      )
      INTO content_exists
      USING p_content_id, p_area, p_user_id;

      RETURN content_exists;

    WHEN 'MZANSI_BUSINESS' THEN
      IF to_regclass('public.businesses') IS NULL THEN
        RETURN FALSE;
      END IF;

      owner_column := CASE
        WHEN public.free_post_owner_column_exists('businesses', 'owner_id') THEN 'owner_id'
        WHEN public.free_post_owner_column_exists('businesses', 'seller_id') THEN 'seller_id'
        ELSE NULL
      END;

      IF owner_column IS NULL THEN
        RETURN FALSE;
      END IF;

      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM public.businesses
           WHERE id = $1
             AND area = $2
             AND %I = $3
         )',
        owner_column
      )
      INTO content_exists
      USING p_content_id, p_area, p_user_id;

      RETURN content_exists;

    WHEN 'PROMOTIONS_EVENTS' THEN
      IF to_regclass('public.promotions') IS NULL THEN
        RETURN FALSE;
      END IF;

      owner_column := CASE
        WHEN public.free_post_owner_column_exists('promotions', 'owner_id') THEN 'owner_id'
        WHEN public.free_post_owner_column_exists('promotions', 'seller_id') THEN 'seller_id'
        ELSE NULL
      END;

      IF owner_column IS NULL THEN
        RETURN FALSE;
      END IF;

      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM public.promotions
           WHERE id = $1
             AND %I = $2
         )',
        owner_column
      )
      INTO content_exists
      USING p_content_id, p_user_id;

      RETURN content_exists;

    ELSE
      RETURN FALSE;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.free_post_area_has_any_content(
  p_user_id UUID,
  p_area marketplace_area
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  owner_column TEXT;
  content_exists BOOLEAN := FALSE;
BEGIN
  CASE p_area
    WHEN 'MZANSI_MARKET' THEN
      IF to_regclass('public.listings') IS NULL THEN
        RETURN FALSE;
      END IF;

      owner_column := CASE
        WHEN public.free_post_owner_column_exists('listings', 'owner_id') THEN 'owner_id'
        WHEN public.free_post_owner_column_exists('listings', 'seller_id') THEN 'seller_id'
        ELSE NULL
      END;

      IF owner_column IS NULL THEN
        RETURN FALSE;
      END IF;

      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM public.listings
           WHERE area = $1
             AND %I = $2
         )',
        owner_column
      )
      INTO content_exists
      USING p_area, p_user_id;

      RETURN content_exists;

    WHEN 'MZANSI_BUSINESS' THEN
      IF to_regclass('public.businesses') IS NULL THEN
        RETURN FALSE;
      END IF;

      owner_column := CASE
        WHEN public.free_post_owner_column_exists('businesses', 'owner_id') THEN 'owner_id'
        WHEN public.free_post_owner_column_exists('businesses', 'seller_id') THEN 'seller_id'
        ELSE NULL
      END;

      IF owner_column IS NULL THEN
        RETURN FALSE;
      END IF;

      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM public.businesses
           WHERE area = $1
             AND %I = $2
         )',
        owner_column
      )
      INTO content_exists
      USING p_area, p_user_id;

      RETURN content_exists;

    WHEN 'PROMOTIONS_EVENTS' THEN
      IF to_regclass('public.promotions') IS NULL THEN
        RETURN FALSE;
      END IF;

      owner_column := CASE
        WHEN public.free_post_owner_column_exists('promotions', 'owner_id') THEN 'owner_id'
        WHEN public.free_post_owner_column_exists('promotions', 'seller_id') THEN 'seller_id'
        ELSE NULL
      END;

      IF owner_column IS NULL THEN
        RETURN FALSE;
      END IF;

      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM public.promotions
           WHERE %I = $1
         )',
        owner_column
      )
      INTO content_exists
      USING p_user_id;

      RETURN content_exists;

    ELSE
      RETURN FALSE;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_free_post_slot(
  p_user_id UUID,
  p_area marketplace_area,
  p_content_id UUID,
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
    hashtext(p_user_id::text || '::free_post::' || p_area::text)
  );

  IF EXISTS (
    SELECT 1
    FROM public.free_posts_used
    WHERE user_id = p_user_id
      AND area = p_area
      AND content_id = p_content_id
      AND released_at IS NULL
  ) THEN
    RETURN TRUE;
  END IF;

  SELECT COUNT(*)
  INTO current_count
  FROM public.free_posts_used
  WHERE user_id = p_user_id
    AND area = p_area
    AND released_at IS NULL;

  IF current_count >= p_max_allowed THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.free_posts_used (user_id, area, content_id)
  VALUES (p_user_id, p_area, p_content_id);

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_free_post_slot(UUID, marketplace_area, UUID, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_free_post_slot(UUID, marketplace_area, UUID, INTEGER)
  TO service_role;
