-- Private post fields, step 2 of 2 (posting audit 2026-10-07). Applied after
-- the app reading business_private / listing_private was deployed (aea4cbe2).
--
-- Writes now move contact details and street addresses into the private
-- tables and leave the public columns empty; existing public copies are
-- cleared; a check constraint keeps them empty if a trigger is ever missed.
-- The unused column-grant helper from 20261007120240 is dropped.

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
  cleared jsonb := '{}'::jsonb;
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    cleared := cleared || jsonb_build_object(col, NULL);
    IF TG_OP = 'INSERT' AND rec->>col IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'INSERT INTO public.%1$I (%2$I, %3$I) VALUES ($1, $2)
       ON CONFLICT (%2$I) DO UPDATE SET %3$I = EXCLUDED.%3$I, updated_at = now()',
      priv, fk, col
    ) USING NEW.id, rec->>col;
  END LOOP;
  -- The public row never keeps them.
  NEW := jsonb_populate_record(NEW, cleared);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_private_post_fields() FROM PUBLIC, anon, authenticated;

-- Clear the public copies (already in the private tables since step 1)
-- without firing update triggers (updated_at, edit guards, search).
ALTER TABLE public.businesses DISABLE TRIGGER USER;
UPDATE public.businesses
   SET phone = NULL, whatsapp = NULL, email = NULL, location_address = NULL, map_directions = NULL
 WHERE COALESCE(phone, whatsapp, email, location_address, map_directions) IS NOT NULL;
ALTER TABLE public.businesses ENABLE TRIGGER USER;

ALTER TABLE public.listings DISABLE TRIGGER USER;
UPDATE public.listings SET location_address = NULL WHERE location_address IS NOT NULL;
ALTER TABLE public.listings ENABLE TRIGGER USER;

ALTER TABLE public.businesses ADD CONSTRAINT businesses_private_fields_elsewhere
  CHECK (phone IS NULL AND whatsapp IS NULL AND email IS NULL
         AND location_address IS NULL AND map_directions IS NULL);
ALTER TABLE public.listings ADD CONSTRAINT listings_private_fields_elsewhere
  CHECK (location_address IS NULL);

DROP FUNCTION IF EXISTS public.grant_public_post_columns();
