-- Private post columns (posting audit 2026-10-07). Applied after the app
-- that stopped reading them was deployed (303cdfab, 2baa5e79).
--
-- Anyone with the public anon key could read live businesses' phone,
-- WhatsApp, email, street address and map pin, and live listings' street
-- address (which the form promises stays private), straight from the
-- database API. Owners could also delete posts directly, skipping media
-- cleanup and the audit log.
--
-- Column privileges replace the table-wide SELECT for anon and authenticated
-- on businesses and listings: every column except the private ones. Servers
-- read those with the service role after their own checks (tap-to-reveal for
-- contact details; the address when the business publishes it).
-- NOTE: a column added to these tables later is not readable by anon or
-- authenticated until granted (re-run public.grant_public_post_columns()).
-- Promotions are unchanged (an event's venue is public by design).

CREATE OR REPLACE FUNCTION public.grant_public_post_columns()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  t text;
  private_cols text[];
  cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY['businesses', 'listings'] LOOP
    private_cols := CASE t
      WHEN 'businesses' THEN ARRAY['phone', 'whatsapp', 'email', 'location_address', 'map_directions']
      ELSE ARRAY['location_address'] END;
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t
       AND column_name <> ALL (private_cols);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon, authenticated', cols, t);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.grant_public_post_columns() FROM PUBLIC, anon, authenticated;

SELECT public.grant_public_post_columns();

-- Deletes go through the app (media cleanup, audit, state and legal-hold
-- rules). Anon never needed write access to posts.
REVOKE DELETE ON public.listings, public.businesses, public.promotions FROM anon, authenticated;
REVOKE UPDATE ON public.listings, public.businesses, public.promotions FROM anon;
