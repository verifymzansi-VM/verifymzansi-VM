-- Business verification privacy fixes.
--
-- 1. businesses.cipc_registered_office is readable by anyone for live
--    businesses (public RLS). It must only ever hold the public view of the
--    office: street lines and postal code only when the owner chose to show
--    them. The app writes publicOffice(); this trigger enforces it as a
--    backstop. The full office stays on the staff-only case.
-- 2. Extracted text of quarantined PDFs must not keep raw SA ID numbers.

CREATE OR REPLACE FUNCTION public.keep_registered_office_public()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.cipc_registered_office IS NOT NULL THEN
    NEW.cipc_registered_office := NEW.cipc_registered_office - 'cityKnown';
    IF NOT coalesce(NEW.show_full_registered_office, false) THEN
      NEW.cipc_registered_office := NEW.cipc_registered_office - 'streetLines' - 'postalCode';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.keep_registered_office_public() FROM PUBLIC, anon, authenticated;

-- Named to run after guard_business_verification_columns (BEFORE triggers
-- fire in name order).
DROP TRIGGER IF EXISTS zz_keep_registered_office_public ON public.businesses;
CREATE TRIGGER zz_keep_registered_office_public
  BEFORE INSERT OR UPDATE OF cipc_registered_office, show_full_registered_office
  ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.keep_registered_office_public();

UPDATE public.businesses
   SET cipc_registered_office = cipc_registered_office - 'streetLines' - 'postalCode' - 'cityKnown'
 WHERE cipc_registered_office IS NOT NULL
   AND NOT show_full_registered_office;

UPDATE public.business_verification_files
   SET extracted_text = regexp_replace(extracted_text, '\d{6}\s?\d{4}\s?\d{3}', '[ID number]', 'g')
 WHERE extracted_text ~ '\d{6}\s?\d{4}\s?\d{3}';
