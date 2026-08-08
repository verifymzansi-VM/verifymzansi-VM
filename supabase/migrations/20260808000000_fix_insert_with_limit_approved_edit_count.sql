-- Fix insert_*_with_limit functions: approved_edit_count NOT NULL DEFAULT 0
-- was added in 20260424150000_content_edit_requests.sql, but the atomic insert
-- functions (20260724010000) don't set it, and jsonb_populate_record fills
-- missing keys with NULL, overriding the column default.
--
-- This causes all listing/promotion/business creates to fail with:
--   23502: null value in column "approved_edit_count" violates not-null constraint

-- ── listings ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.insert_listing_with_limit(
  p_user_id UUID,
  p_area TEXT,
  p_max_allowed INTEGER,
  p_data JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER;
  rec public.listings;
  inserted_row JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text || '::listing_limit::' || p_area)
  );

  IF p_max_allowed >= 0 THEN
    SELECT COUNT(*)
    INTO current_count
    FROM public.listings
    WHERE owner_id = p_user_id
      AND area = p_area
      AND status <> 'rejected';

    IF current_count >= p_max_allowed THEN
      RETURN jsonb_build_object('limit_reached', true);
    END IF;
  END IF;

  -- Ownership is decided by the authenticated caller, never by the payload.
  p_data := jsonb_set(p_data, '{owner_id}', to_jsonb(p_user_id::text), true);

  -- Later-added NOT NULL counter: default-fill only when the column exists.
  IF NOT (p_data ? 'view_count') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'listings'
      AND column_name = 'view_count'
  ) THEN
    p_data := jsonb_set(p_data, '{view_count}', '0'::jsonb, true);
  END IF;

  -- approved_edit_count: NOT NULL DEFAULT 0 added in 20260424150000.
  IF NOT (p_data ? 'approved_edit_count') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'listings'
      AND column_name = 'approved_edit_count'
  ) THEN
    p_data := jsonb_set(p_data, '{approved_edit_count}', '0'::jsonb, true);
  END IF;

  rec := jsonb_populate_record(NULL::public.listings, p_data);

  -- Restore base-schema defaults for fields the app omits.
  rec.id := COALESCE(rec.id, gen_random_uuid());
  rec.area := COALESCE(rec.area, 'MZANSI_MARKET');
  rec.videos := COALESCE(rec.videos, '{}');
  rec.price_negotiable := COALESCE(rec.price_negotiable, false);
  rec.buyer_verification_required := COALESCE(rec.buyer_verification_required, false);
  rec.attributes := COALESCE(rec.attributes, '{}');
  rec.status := COALESCE(rec.status, 'draft');
  rec.featured := COALESCE(rec.featured, false);
  rec.urgent := COALESCE(rec.urgent, false);
  rec.created_at := COALESCE(rec.created_at, now());
  rec.updated_at := COALESCE(rec.updated_at, now());

  INSERT INTO public.listings VALUES (rec.*)
  RETURNING to_jsonb(listings.*) INTO inserted_row;

  RETURN inserted_row;
END;
$$;

-- ── promotions ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.insert_promotion_with_limit(
  p_user_id UUID,
  p_area TEXT,
  p_max_allowed INTEGER,
  p_data JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER;
  rec public.promotions;
  inserted_row JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text || '::promotion_limit::' || p_area)
  );

  IF p_max_allowed >= 0 THEN
    -- Mirrors check_promotion_limit: promotions are counted per owner across
    -- the whole table (no area predicate).
    SELECT COUNT(*)
    INTO current_count
    FROM public.promotions
    WHERE owner_id = p_user_id
      AND status <> 'rejected';

    IF current_count >= p_max_allowed THEN
      RETURN jsonb_build_object('limit_reached', true);
    END IF;
  END IF;

  p_data := jsonb_set(p_data, '{owner_id}', to_jsonb(p_user_id::text), true);

  IF NOT (p_data ? 'view_count') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'promotions'
      AND column_name = 'view_count'
  ) THEN
    p_data := jsonb_set(p_data, '{view_count}', '0'::jsonb, true);
  END IF;

  IF NOT (p_data ? 'click_count') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'promotions'
      AND column_name = 'click_count'
  ) THEN
    p_data := jsonb_set(p_data, '{click_count}', '0'::jsonb, true);
  END IF;

  -- approved_edit_count: NOT NULL DEFAULT 0 added in 20260424150000.
  IF NOT (p_data ? 'approved_edit_count') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'promotions'
      AND column_name = 'approved_edit_count'
  ) THEN
    p_data := jsonb_set(p_data, '{approved_edit_count}', '0'::jsonb, true);
  END IF;

  -- social_distribution_authorized: NOT NULL DEFAULT false added in 20260323000000.
  IF NOT (p_data ? 'social_distribution_authorized') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'promotions'
      AND column_name = 'social_distribution_authorized'
  ) THEN
    p_data := jsonb_set(p_data, '{social_distribution_authorized}', 'false'::jsonb, true);
  END IF;

  -- social_authorizer_relationship: NOT NULL DEFAULT 'owner' added in 20260323000000.
  IF NOT (p_data ? 'social_authorizer_relationship') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'promotions'
      AND column_name = 'social_authorizer_relationship'
  ) THEN
    p_data := jsonb_set(p_data, '{social_authorizer_relationship}', '"owner"'::jsonb, true);
  END IF;

  -- social_monetization_acknowledged: NOT NULL DEFAULT false added in 20260323000000.
  IF NOT (p_data ? 'social_monetization_acknowledged') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'promotions'
      AND column_name = 'social_monetization_acknowledged'
  ) THEN
    p_data := jsonb_set(p_data, '{social_monetization_acknowledged}', 'false'::jsonb, true);
  END IF;

  rec := jsonb_populate_record(NULL::public.promotions, p_data);

  rec.id := COALESCE(rec.id, gen_random_uuid());
  rec.promotion_type := COALESCE(rec.promotion_type, 'general');
  rec.photos := COALESCE(rec.photos, '{}');
  rec.videos := COALESCE(rec.videos, '{}');
  rec.price_negotiable := COALESCE(rec.price_negotiable, false);
  rec.contact_methods := COALESCE(rec.contact_methods, '{call}');
  rec.status := COALESCE(rec.status, 'draft');
  rec.created_at := COALESCE(rec.created_at, now());
  rec.updated_at := COALESCE(rec.updated_at, now());

  INSERT INTO public.promotions VALUES (rec.*)
  RETURNING to_jsonb(promotions.*) INTO inserted_row;

  RETURN inserted_row;
END;
$$;

-- ── businesses ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.insert_business_with_limit(
  p_user_id UUID,
  p_area TEXT,
  p_max_allowed INTEGER,
  p_data JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER;
  owner_column TEXT;
  rec public.businesses;
  inserted_row JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text || '::business_limit::' || p_area)
  );

  -- Mirrors check_business_limit: owner_id is preferred, seller_id is the
  -- legacy fallback on schemas that predate the owner_id migration.
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

  IF p_max_allowed >= 0 THEN
    EXECUTE format(
      'SELECT COUNT(*) FROM public.businesses WHERE %I = $1 AND area = $2 AND status <> ''rejected''',
      owner_column
    )
    INTO current_count
    USING p_user_id, p_area;

    IF current_count >= p_max_allowed THEN
      RETURN jsonb_build_object('limit_reached', true);
    END IF;
  END IF;

  p_data := jsonb_set(p_data, ARRAY[owner_column], to_jsonb(p_user_id::text), true);

  IF NOT (p_data ? 'view_count') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'view_count'
  ) THEN
    p_data := jsonb_set(p_data, '{view_count}', '0'::jsonb, true);
  END IF;

  -- approved_edit_count: NOT NULL DEFAULT 0 added in 20260424150000.
  IF NOT (p_data ? 'approved_edit_count') AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'approved_edit_count'
  ) THEN
    p_data := jsonb_set(p_data, '{approved_edit_count}', '0'::jsonb, true);
  END IF;

  rec := jsonb_populate_record(NULL::public.businesses, p_data);

  rec.id := COALESCE(rec.id, gen_random_uuid());
  rec.area := COALESCE(rec.area, 'MZANSI_BUSINESS');
  rec.category := COALESCE(rec.category, 'general_other');
  rec.status := COALESCE(rec.status, 'draft');
  rec.created_at := COALESCE(rec.created_at, now());
  rec.updated_at := COALESCE(rec.updated_at, now());

  INSERT INTO public.businesses VALUES (rec.*)
  RETURNING to_jsonb(businesses.*) INTO inserted_row;

  RETURN inserted_row;
END;
$$;

-- Re-assert service-role-only execution (unchanged from 20260724010000).
REVOKE EXECUTE ON FUNCTION public.insert_listing_with_limit(UUID, TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_listing_with_limit(UUID, TEXT, INTEGER, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_listing_with_limit(UUID, TEXT, INTEGER, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_listing_with_limit(UUID, TEXT, INTEGER, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.insert_promotion_with_limit(UUID, TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_promotion_with_limit(UUID, TEXT, INTEGER, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_promotion_with_limit(UUID, TEXT, INTEGER, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_promotion_with_limit(UUID, TEXT, INTEGER, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.insert_business_with_limit(UUID, TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_business_with_limit(UUID, TEXT, INTEGER, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_business_with_limit(UUID, TEXT, INTEGER, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_business_with_limit(UUID, TEXT, INTEGER, JSONB) TO service_role;
