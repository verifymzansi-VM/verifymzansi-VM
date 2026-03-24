CREATE OR REPLACE FUNCTION public.normalize_sa_phone(phone_input TEXT)
RETURNS TEXT AS $$
DECLARE
  digits TEXT;
  trimmed TEXT;
BEGIN
  IF phone_input IS NULL THEN
    RETURN NULL;
  END IF;

  trimmed := btrim(phone_input);
  IF trimmed = '' THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(trimmed, '\\D', '', 'g');

  IF digits LIKE '27%' AND length(digits) = 11 THEN
    RETURN '+' || digits;
  END IF;

  IF digits LIKE '0%' AND length(digits) = 10 THEN
    RETURN '+27' || substr(digits, 2);
  END IF;

  RETURN trimmed;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
CREATE OR REPLACE FUNCTION public.mask_phone_public(phone_input TEXT)
RETURNS TEXT AS $$
DECLARE
  normalized TEXT;
  digits TEXT;
  last_two TEXT;
BEGIN
  normalized := public.normalize_sa_phone(phone_input);

  IF normalized IS NULL THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(normalized, '\\D', '', 'g');
  IF length(digits) < 4 THEN
    RETURN '••••••••';
  END IF;

  last_two := right(digits, 2);

  IF digits LIKE '27%' THEN
    RETURN '+27 •••• ••' || last_two;
  END IF;

  RETURN '••••• •••' || last_two;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
CREATE OR REPLACE FUNCTION public.sync_seller_profile_phone_fields()
RETURNS TRIGGER AS $$
BEGIN
  NEW.phone := public.normalize_sa_phone(NEW.phone);
  NEW.masked_phone_public := public.mask_phone_public(NEW.phone);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS sync_seller_profile_phone_fields ON public.seller_profiles;
CREATE TRIGGER sync_seller_profile_phone_fields
  BEFORE INSERT OR UPDATE OF phone ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_seller_profile_phone_fields();
UPDATE public.seller_profiles
SET
  phone = public.normalize_sa_phone(phone),
  masked_phone_public = public.mask_phone_public(phone)
WHERE phone IS NOT NULL OR masked_phone_public IS DISTINCT FROM public.mask_phone_public(phone);
