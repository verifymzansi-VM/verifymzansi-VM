-- Close the paid-plan post-limit TOCTOU (M1 / carryover #25).
--
-- check_listing_limit / check_promotion_limit / check_business_limit take a
-- per-user advisory lock, count, and return — but pg_advisory_xact_lock
-- releases when the RPC's own transaction ends, while the content INSERT runs
-- in a separate, later transaction. Two concurrent creates could both pass
-- the count check and both insert, exceeding the plan limit by one.
--
-- These functions mirror the claim_free_post_slot pattern: the per-user
-- advisory lock is held across BOTH the count check and the content insert,
-- so concurrent requests fully serialize and the limit can never be exceeded.
-- They reuse the same lock keys as the check_*_limit functions so old and new
-- code paths serialize against each other during rollout.
--
-- p_max_allowed < 0 skips the limit check entirely (unlimited plans,
-- free-post users whose limit is enforced by the free_posts_used ledger, and
-- posting-limit bypass mode).
--
-- Returns the inserted row as JSONB, or {"limit_reached": true} when the
-- caller's plan limit is already exhausted.
--
-- Payload handling notes:
-- * jsonb_populate_record types every value against the real column types
--   (arrays, JSONB, enums, timestamps) and silently ignores JSON keys that
--   have no matching column, preserving the app-level compatibility behavior
--   for databases missing newer columns.
-- * Ownership is forced to the authenticated caller inside the function, so
--   the owner field can never be spoofed through the payload. The
--   sync_owner_id_with_seller_id BEFORE INSERT trigger keeps the legacy
--   seller_id/owner_id pair consistent.
-- * Column defaults the app omits are restored with COALESCE, because
--   populate_record fills missing keys with NULL (which would otherwise
--   override NOT NULL DEFAULT columns such as view_count or timestamps).
-- * Later-added counter columns are pre-filled in the JSON payload only when
--   the column actually exists (schema-drift safe).

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

-- Service-role-only execution, matching the 20260430040000 posture for
-- SECURITY DEFINER helpers. The create routes call these via the admin
-- client; they must never be reachable by anon/authenticated RPC callers.
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

-- Rollout note: check_listing_limit / check_promotion_limit /
-- check_business_limit are intentionally LEFT IN PLACE so app code deployed
-- before this migration keeps working. Once every environment runs the new
-- insert_*_with_limit call sites, the old functions can be dropped in a
-- follow-up cleanup migration.
