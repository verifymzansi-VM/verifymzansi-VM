-- Convert free-post tracking from a single boolean flag into a ledger that
-- supports multiple free posts per area and auditable slot releases.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'free_posts_used'
      AND column_name = 'listing_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'free_posts_used'
      AND column_name = 'content_id'
  ) THEN
    ALTER TABLE public.free_posts_used RENAME COLUMN listing_id TO content_id;
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'free_posts_used'
      AND column_name = 'listing_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'free_posts_used'
      AND column_name = 'content_id'
  ) THEN
    UPDATE public.free_posts_used
    SET content_id = COALESCE(content_id, listing_id)
    WHERE listing_id IS NOT NULL;

    ALTER TABLE public.free_posts_used DROP COLUMN listing_id;
  END IF;
END $$;

ALTER TABLE public.free_posts_used
  ADD COLUMN IF NOT EXISTS content_id UUID,
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS release_reason TEXT;

ALTER TABLE public.free_posts_used
  DROP CONSTRAINT IF EXISTS free_posts_used_user_area_unique;

DROP INDEX IF EXISTS idx_free_posts_used_user_area;

CREATE UNIQUE INDEX IF NOT EXISTS idx_free_posts_used_user_area_content_unique
  ON public.free_posts_used (user_id, area, content_id);

CREATE INDEX IF NOT EXISTS idx_free_posts_used_active_claims
  ON public.free_posts_used (user_id, area)
  WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION public.free_post_owner_column_exists(
  p_table_name TEXT,
  p_column_name TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table_name
      AND column_name = p_column_name
  );
$$;

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

    WHEN 'MZANSI_BUSINESS', 'BUSINESS_ADS' THEN
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

    WHEN 'MALL_SHOPS' THEN
      IF to_regclass('public.storefronts') IS NULL THEN
        RETURN FALSE;
      END IF;

      owner_column := CASE
        WHEN public.free_post_owner_column_exists('storefronts', 'owner_id') THEN 'owner_id'
        WHEN public.free_post_owner_column_exists('storefronts', 'seller_id') THEN 'seller_id'
        ELSE NULL
      END;

      IF owner_column IS NULL THEN
        RETURN FALSE;
      END IF;

      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM public.storefronts
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

    WHEN 'MZANSI_BUSINESS', 'BUSINESS_ADS' THEN
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

    WHEN 'MALL_SHOPS' THEN
      IF to_regclass('public.storefronts') IS NULL THEN
        RETURN FALSE;
      END IF;

      owner_column := CASE
        WHEN public.free_post_owner_column_exists('storefronts', 'owner_id') THEN 'owner_id'
        WHEN public.free_post_owner_column_exists('storefronts', 'seller_id') THEN 'seller_id'
        ELSE NULL
      END;

      IF owner_column IS NULL THEN
        RETURN FALSE;
      END IF;

      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1
           FROM public.storefronts
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

-- Auto-repair legacy rows:
-- 1. Release claims whose linked content no longer exists.
-- 2. Release legacy rows without content IDs only when the owner has no
--    remaining content at all in that area.
-- Rejected content still counts until the owner deletes it.
UPDATE public.free_posts_used AS fpu
SET
  released_at = COALESCE(fpu.released_at, now()),
  release_reason = COALESCE(fpu.release_reason, 'legacy_backfill_deleted_content')
WHERE fpu.released_at IS NULL
  AND fpu.content_id IS NOT NULL
  AND NOT public.free_post_content_exists(fpu.user_id, fpu.area, fpu.content_id);

UPDATE public.free_posts_used AS fpu
SET
  released_at = COALESCE(fpu.released_at, now()),
  release_reason = COALESCE(fpu.release_reason, 'legacy_backfill_no_surviving_content')
WHERE fpu.released_at IS NULL
  AND fpu.content_id IS NULL
  AND NOT public.free_post_area_has_any_content(fpu.user_id, fpu.area);

DROP FUNCTION IF EXISTS public.free_post_area_has_any_content(UUID, marketplace_area);
DROP FUNCTION IF EXISTS public.free_post_content_exists(UUID, marketplace_area, UUID);
DROP FUNCTION IF EXISTS public.free_post_owner_column_exists(TEXT, TEXT);

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
