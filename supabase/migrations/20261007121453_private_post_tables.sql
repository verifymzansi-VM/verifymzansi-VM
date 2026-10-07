-- Private post fields, step 1 of 2 (posting audit 2026-10-07).
--
-- Business phone, WhatsApp, email, street address and map pin, and a
-- listing's street address, are readable by anyone with the public anon key
-- because they live on rows the public can select. Column-level grants can't
-- hide them: the showroom feeds order by fair_rotation_key(row), a whole-row
-- reference that needs every column (see 20261007120524).
--
-- They move to server-only tables. Step 1 (this file) creates the tables,
-- copies existing values and keeps them in sync on every write, while the
-- public columns still hold them, so the deployed app keeps working. Step 2,
-- after the app reads the private tables, empties the public columns and
-- makes every write move the values instead of copying them.
--
-- Writes need no app change: insert and per-column update triggers copy what
-- is written (UPDATE OF fires only for columns in the SET list, so a partial
-- update never clears a field it didn't send).

CREATE TABLE public.business_private (
  business_id uuid PRIMARY KEY
    REFERENCES public.businesses(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  phone text,
  whatsapp text,
  email text,
  location_address text,
  map_directions text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.listing_private (
  listing_id uuid PRIMARY KEY
    REFERENCES public.listings(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  location_address text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Service role only: row security on, no policies, no grants to app roles.
ALTER TABLE public.business_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_private, public.listing_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.business_private, public.listing_private TO service_role;

-- Copies the private fields named in the trigger arguments from the written
-- row into the private table. SECURITY DEFINER: owners update listings with
-- their own session, which can't write the private table.
CREATE OR REPLACE FUNCTION public.sync_private_post_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  priv text := CASE TG_TABLE_NAME WHEN 'businesses' THEN 'business_private' ELSE 'listing_private' END;
  fk text := CASE TG_TABLE_NAME WHEN 'businesses' THEN 'business_id' ELSE 'listing_id' END;
  rec jsonb := to_jsonb(NEW);
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF TG_OP = 'INSERT' AND rec->>col IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'INSERT INTO public.%1$I (%2$I, %3$I) VALUES ($1, $2)
       ON CONFLICT (%2$I) DO UPDATE SET %3$I = EXCLUDED.%3$I, updated_at = now()',
      priv, fk, col
    ) USING NEW.id, rec->>col;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_private_post_fields() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER private_fields_on_insert BEFORE INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.sync_private_post_fields(
    'phone', 'whatsapp', 'email', 'location_address', 'map_directions');
CREATE TRIGGER private_field_phone BEFORE UPDATE OF phone ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.sync_private_post_fields('phone');
CREATE TRIGGER private_field_whatsapp BEFORE UPDATE OF whatsapp ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.sync_private_post_fields('whatsapp');
CREATE TRIGGER private_field_email BEFORE UPDATE OF email ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.sync_private_post_fields('email');
CREATE TRIGGER private_field_location_address BEFORE UPDATE OF location_address ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.sync_private_post_fields('location_address');
CREATE TRIGGER private_field_map_directions BEFORE UPDATE OF map_directions ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.sync_private_post_fields('map_directions');

CREATE TRIGGER private_fields_on_insert BEFORE INSERT ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.sync_private_post_fields('location_address');
CREATE TRIGGER private_field_location_address BEFORE UPDATE OF location_address ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.sync_private_post_fields('location_address');

INSERT INTO public.business_private (business_id, phone, whatsapp, email, location_address, map_directions)
SELECT id, phone, whatsapp, email, location_address, map_directions
  FROM public.businesses
 WHERE COALESCE(phone, whatsapp, email, location_address, map_directions) IS NOT NULL;

INSERT INTO public.listing_private (listing_id, location_address)
SELECT id, location_address FROM public.listings WHERE location_address IS NOT NULL;

-- Organisation admins see an applying business's contact details from the
-- private table (unchanged output).
CREATE OR REPLACE FUNCTION public.org_list_applications(p_user uuid, p_org uuid, p_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, status text, business_id uuid, business_name text, category text, city text, province text, business_phone text, business_email text, business_website text, representative_name text, identity_verified boolean, programme_name text, reason text, member_reference text, info_request text, info_response text, submitted_at timestamp with time zone, decision_at timestamp with time zone, decision_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT (public.is_organisation_admin(p_org,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 -- Deliberately minimal: no ID documents, selfies, hashes, risk or fraud data.
 RETURN QUERY
 SELECT a.id, a.status, b.id, b.business_name::text, b.category::text, b.location_city::text, b.location_province::text,
  bp.phone::text, bp.email::text, b.website::text,
  CASE WHEN COALESCE((a.consent_fields->>'shareRepresentativeName')::boolean,false)
   THEN nullif(btrim(concat_ws(' ', p.legal_first_name, p.legal_last_name)),'') END,
  p.account_verification_status::text = 'verified',
  pr.name, a.reason, a.member_reference, a.info_request, a.info_response, a.created_at, a.decision_at, a.decision_note
 FROM public.organisation_applications a
 JOIN public.businesses b ON b.id = a.business_id
 LEFT JOIN public.business_private bp ON bp.business_id = b.id
 LEFT JOIN public.account_profiles p ON p.user_id = a.applicant_id
 LEFT JOIN public.organisation_programmes pr ON pr.id = a.programme_id
 WHERE a.organisation_id = p_org AND (p_status IS NULL OR a.status = p_status)
 ORDER BY a.created_at DESC LIMIT 500;
END;
$function$;
