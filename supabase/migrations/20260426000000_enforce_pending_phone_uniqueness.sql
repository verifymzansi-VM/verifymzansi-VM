-- Enforce account phone uniqueness while numbers are still staged for OTP.
--
-- A phone number must belong to only one account, whether it is already
-- verified in account_profiles.phone or waiting in account_profiles.pending_phone.

BEGIN;

UPDATE public.account_profiles
SET pending_phone = public.normalize_sa_phone(pending_phone)
WHERE pending_phone IS NOT NULL;

UPDATE public.account_profiles
SET pending_phone = NULL
WHERE pending_phone IS NOT NULL
  AND phone IS NOT NULL
  AND pending_phone = public.normalize_sa_phone(phone);

UPDATE public.account_profiles ap
SET pending_phone = NULL
WHERE ap.pending_phone IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.account_profiles claimed
    WHERE claimed.phone = ap.pending_phone
      AND claimed.id IS DISTINCT FROM ap.id
  );

WITH ranked_pending_phone AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY pending_phone
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.account_profiles
  WHERE pending_phone IS NOT NULL
)
UPDATE public.account_profiles ap
SET pending_phone = NULL
FROM ranked_pending_phone r
WHERE ap.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_profiles_unique_pending_phone
  ON public.account_profiles (pending_phone)
  WHERE pending_phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_account_profile_phone_fields()
RETURNS TRIGGER AS $$
DECLARE
  conflicting_profile UUID;
  phone_claim TEXT;
BEGIN
  NEW.phone := public.normalize_sa_phone(NEW.phone);
  NEW.pending_phone := public.normalize_sa_phone(NEW.pending_phone);
  NEW.masked_phone_public := public.mask_phone_public(NEW.phone);

  FOR phone_claim IN
    SELECT DISTINCT claim
    FROM unnest(ARRAY[NEW.phone, NEW.pending_phone]) AS phone_claims(claim)
    WHERE claim IS NOT NULL
    ORDER BY claim
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(phone_claim, 0));
  END LOOP;

  IF NEW.phone IS NOT NULL THEN
    SELECT ap.id
    INTO conflicting_profile
    FROM public.account_profiles ap
    WHERE ap.id IS DISTINCT FROM NEW.id
      AND (ap.phone = NEW.phone OR ap.pending_phone = NEW.phone)
    LIMIT 1;

    IF conflicting_profile IS NOT NULL THEN
      RAISE EXCEPTION 'Phone number already linked to another account'
        USING ERRCODE = '23505',
              CONSTRAINT = 'account_profiles_phone_unique';
    END IF;
  END IF;

  IF NEW.pending_phone IS NOT NULL THEN
    SELECT ap.id
    INTO conflicting_profile
    FROM public.account_profiles ap
    WHERE ap.id IS DISTINCT FROM NEW.id
      AND (ap.phone = NEW.pending_phone OR ap.pending_phone = NEW.pending_phone)
    LIMIT 1;

    IF conflicting_profile IS NOT NULL THEN
      RAISE EXCEPTION 'Phone number already linked to another account'
        USING ERRCODE = '23505',
              CONSTRAINT = 'account_profiles_pending_phone_unique';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION public.sync_account_profile_phone_fields()
  SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS sync_account_profile_phone_fields ON public.account_profiles;
CREATE TRIGGER sync_account_profile_phone_fields
  BEFORE INSERT OR UPDATE OF phone, pending_phone ON public.account_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_account_profile_phone_fields();

COMMIT;
