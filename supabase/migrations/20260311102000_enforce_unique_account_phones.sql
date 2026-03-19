CREATE INDEX IF NOT EXISTS idx_seller_profiles_phone
ON public.seller_profiles(phone)
WHERE phone IS NOT NULL;
CREATE OR REPLACE FUNCTION public.sync_seller_profile_phone_fields()
RETURNS TRIGGER AS $$
DECLARE
  conflicting_profile UUID;
BEGIN
  NEW.phone := public.normalize_sa_phone(NEW.phone);
  NEW.masked_phone_public := public.mask_phone_public(NEW.phone);

  IF NEW.phone IS NOT NULL THEN
    SELECT sp.id
    INTO conflicting_profile
    FROM public.seller_profiles sp
    WHERE sp.phone = NEW.phone
      AND sp.id IS DISTINCT FROM NEW.id
    LIMIT 1;

    IF conflicting_profile IS NOT NULL THEN
      RAISE EXCEPTION 'Phone number already linked to another account'
        USING ERRCODE = '23505',
              CONSTRAINT = 'seller_profiles_phone_unique';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
