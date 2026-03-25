-- ---------------------------------------------------------------------------
-- Migration: pending_phone_canonical
--
-- Enforce a stricter phone invariant: a phone number is only canonical
-- (stored in account_profiles.phone) after it has been OTP-verified.
-- Before verification the submitted number lives in pending_phone.
--
-- This makes the Gmail OAuth path and the manual email registration path
-- identical: both write to pending_phone first; OTP verify promotes to phone.
-- ---------------------------------------------------------------------------

-- 1. Add staging column for unverified phone numbers.
ALTER TABLE public.account_profiles
  ADD COLUMN IF NOT EXISTS pending_phone TEXT;

-- 2. Back-fill: any user whose phone was saved without OTP evidence moves to
--    pending_phone so they are prompted to verify on their next dashboard visit.
--    Users who already completed the phone OTP step keep their canonical phone.
UPDATE public.account_profiles ap
SET
  pending_phone       = ap.phone,
  phone               = NULL,
  masked_phone_public = NULL
WHERE ap.phone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.verification_steps vs
    WHERE vs.user_id  = ap.user_id
      AND vs.step_type = 'phone'
      AND vs.status    = 'approved'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.verification_sessions vss
    WHERE vss.user_id = ap.user_id
      AND vss.phone_verified_at IS NOT NULL
  );
