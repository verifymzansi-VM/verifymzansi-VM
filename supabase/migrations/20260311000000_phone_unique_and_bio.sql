-- Add bio column to seller_profiles and enforce phone uniqueness

-- 1. Add bio column
ALTER TABLE public.seller_profiles ADD COLUMN IF NOT EXISTS bio TEXT;
-- 2. Deduplicate phones: keep on earliest account, NULL the rest
WITH ranked AS (
  SELECT id, phone, ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at ASC) AS rn
  FROM public.seller_profiles
  WHERE phone IS NOT NULL
)
UPDATE public.seller_profiles sp
SET phone = NULL, masked_phone_public = NULL
FROM ranked r
WHERE sp.id = r.id AND r.rn > 1;
-- 3. Enforce phone uniqueness (partial index allows NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_profiles_unique_phone
  ON public.seller_profiles (phone)
  WHERE phone IS NOT NULL;
-- 4. Update account_profiles view to include bio
CREATE OR REPLACE VIEW public.account_profiles AS
SELECT
  sp.id,
  sp.user_id,
  sp.user_id AS owner_id,
  sp.display_name,
  sp.bio,
  sp.seller_verification_status,
  sp.phone,
  sp.masked_phone_public,
  sp.location_province,
  sp.location_city,
  sp.location_verified_at,
  sp.account_status,
  sp.strikes,
  sp.suspended_until,
  sp.banned_at,
  sp.ban_reason,
  sp.legal_hold,
  sp.profile_completeness_score,
  sp.created_at,
  sp.updated_at
FROM public.seller_profiles sp;
COMMENT ON VIEW public.account_profiles IS
  'Compatibility view exposing seller_profiles through neutral account/member terminology.';
