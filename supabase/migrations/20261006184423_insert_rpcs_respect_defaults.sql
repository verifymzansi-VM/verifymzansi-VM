-- Posting RPCs must let column defaults apply.
--
-- insert_{business,listing,promotion}_with_limit built the row with
-- jsonb_populate_record(NULL::table, p_data) and inserted VALUES (rec.*), so
-- every key the payload omitted became an explicit NULL. NOT NULL columns
-- added later with a default (edited_since_review, engaged_view_count,
-- show_full_registered_office) therefore broke every new post.
--
-- insert_jsonb_row inserts only the columns present in the payload; the
-- database fills the rest from their defaults, now and for future columns.
-- Limits, locking and the forced owner column are unchanged.

CREATE OR REPLACE FUNCTION public.insert_jsonb_row(p_table text, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  cols text;
  inserted jsonb;
BEGIN
  IF p_table NOT IN ('businesses', 'listings', 'promotions') THEN
    RAISE EXCEPTION 'insert_jsonb_row: unsupported table %', p_table;
  END IF;
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = p_table
     AND c.is_generated = 'NEVER'
     AND p_data ? c.column_name;
  IF cols IS NULL THEN
    RAISE EXCEPTION 'insert_jsonb_row: no known columns in payload';
  END IF;
  EXECUTE format(
    'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1) RETURNING to_jsonb(%1$I.*)',
    p_table, cols)
    USING p_data
    INTO inserted;
  RETURN inserted;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.insert_jsonb_row(text, jsonb) FROM PUBLIC, anon, authenticated;

-- Fill keys that are absent or JSON null (the old COALESCE behaviour).
CREATE OR REPLACE FUNCTION public.jsonb_fill_missing(p_data jsonb, p_defaults jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_data || coalesce(jsonb_object_agg(d.key, d.value), '{}'::jsonb)
    FROM jsonb_each(p_defaults) d
   WHERE p_data -> d.key IS NULL OR p_data -> d.key = 'null'::jsonb
$$;
REVOKE EXECUTE ON FUNCTION public.jsonb_fill_missing(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.insert_business_with_limit(p_user_id uuid, p_area text, p_max_allowed integer, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE current_count INTEGER; owner_column TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '::posting_area_limit::' || p_area));
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'owner_id') THEN owner_column := 'owner_id'; ELSE owner_column := 'seller_id'; END IF;
  IF p_max_allowed >= 0 THEN current_count := public.posting_area_used(p_user_id,p_area); IF current_count >= p_max_allowed THEN RETURN jsonb_build_object('limit_reached', true); END IF; END IF;
  p_data := jsonb_set(p_data, ARRAY[owner_column], to_jsonb(p_user_id::text), true);
  IF NOT (p_data ? 'view_count') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'view_count') THEN p_data := jsonb_set(p_data, '{view_count}', '0'::jsonb, true); END IF;
  IF NOT (p_data ? 'approved_edit_count') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'approved_edit_count') THEN p_data := jsonb_set(p_data, '{approved_edit_count}', '0'::jsonb, true); END IF;
  p_data := public.jsonb_fill_missing(p_data, jsonb_build_object(
    'id', gen_random_uuid(), 'area', 'MZANSI_BUSINESS', 'category', 'general_other',
    'status', 'draft', 'created_at', now(), 'updated_at', now()));
  RETURN public.insert_jsonb_row('businesses', p_data);
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_listing_with_limit(p_user_id uuid, p_area text, p_max_allowed integer, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE current_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '::posting_area_limit::' || p_area));
  IF p_max_allowed >= 0 THEN
    current_count := public.posting_area_used(p_user_id,p_area);
    IF current_count >= p_max_allowed THEN RETURN jsonb_build_object('limit_reached', true); END IF;
  END IF;
  p_data := jsonb_set(p_data, '{owner_id}', to_jsonb(p_user_id::text), true);
  IF NOT (p_data ? 'view_count') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'listings' AND column_name = 'view_count') THEN
    p_data := jsonb_set(p_data, '{view_count}', '0'::jsonb, true);
  END IF;
  IF NOT (p_data ? 'approved_edit_count') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'listings' AND column_name = 'approved_edit_count') THEN
    p_data := jsonb_set(p_data, '{approved_edit_count}', '0'::jsonb, true);
  END IF;
  p_data := public.jsonb_fill_missing(p_data, jsonb_build_object(
    'id', gen_random_uuid(), 'area', 'MZANSI_MARKET', 'videos', '[]'::jsonb,
    'price_negotiable', false, 'buyer_verification_required', false, 'attributes', '{}'::jsonb,
    'status', 'draft', 'featured', false, 'urgent', false, 'created_at', now(), 'updated_at', now()));
  RETURN public.insert_jsonb_row('listings', p_data);
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_promotion_with_limit(p_user_id uuid, p_area text, p_max_allowed integer, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE current_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '::posting_area_limit::' || p_area));
  IF p_max_allowed >= 0 THEN current_count := public.posting_area_used(p_user_id,p_area); IF current_count >= p_max_allowed THEN RETURN jsonb_build_object('limit_reached', true); END IF; END IF;
  p_data := jsonb_set(p_data, '{owner_id}', to_jsonb(p_user_id::text), true);
  IF NOT (p_data ? 'view_count') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'promotions' AND column_name = 'view_count') THEN p_data := jsonb_set(p_data, '{view_count}', '0'::jsonb, true); END IF;
  IF NOT (p_data ? 'click_count') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'promotions' AND column_name = 'click_count') THEN p_data := jsonb_set(p_data, '{click_count}', '0'::jsonb, true); END IF;
  IF NOT (p_data ? 'approved_edit_count') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'promotions' AND column_name = 'approved_edit_count') THEN p_data := jsonb_set(p_data, '{approved_edit_count}', '0'::jsonb, true); END IF;
  IF NOT (p_data ? 'social_distribution_authorized') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'promotions' AND column_name = 'social_distribution_authorized') THEN p_data := jsonb_set(p_data, '{social_distribution_authorized}', 'false'::jsonb, true); END IF;
  IF NOT (p_data ? 'social_authorizer_relationship') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'promotions' AND column_name = 'social_authorizer_relationship') THEN p_data := jsonb_set(p_data, '{social_authorizer_relationship}', '"owner"'::jsonb, true); END IF;
  IF NOT (p_data ? 'social_monetization_acknowledged') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'promotions' AND column_name = 'social_monetization_acknowledged') THEN p_data := jsonb_set(p_data, '{social_monetization_acknowledged}', 'false'::jsonb, true); END IF;
  p_data := public.jsonb_fill_missing(p_data, jsonb_build_object(
    'id', gen_random_uuid(), 'promotion_type', 'general', 'photos', '[]'::jsonb,
    'videos', '[]'::jsonb, 'price_negotiable', false, 'contact_methods', '["call"]'::jsonb,
    'status', 'draft', 'created_at', now(), 'updated_at', now()));
  RETURN public.insert_jsonb_row('promotions', p_data);
END;
$$;
