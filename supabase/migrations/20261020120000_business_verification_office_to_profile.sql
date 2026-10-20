-- The owner's choice, made when they upload their CIPC document, to use the
-- company's registered office as the business address. The server applies it
-- only when staff approve the CIPC sticker. Writes stay server-only: members
-- have no INSERT/UPDATE on business_verifications
-- (20261006124457_business_verifications.sql).
ALTER TABLE public.business_verifications
  ADD COLUMN IF NOT EXISTS apply_office_to_profile boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.business_verifications.apply_office_to_profile IS
  'Owner asked to use the registered office as the business address; applied on approval.';
