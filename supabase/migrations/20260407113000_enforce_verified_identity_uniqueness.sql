-- Enforce verified-identity uniqueness across accounts.
-- Policy: uniqueness is required when values are verified/finalized.

BEGIN;

-- Canonicalize staged emails before dedupe/index creation.
UPDATE public.account_profiles
SET pending_email = NULLIF(lower(btrim(pending_email)), '')
WHERE pending_email IS NOT NULL;

-- Keep the earliest staged owner for duplicate pending emails.
WITH ranked_pending_email AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lower(btrim(pending_email))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.account_profiles
  WHERE pending_email IS NOT NULL
)
UPDATE public.account_profiles ap
SET pending_email = NULL
FROM ranked_pending_email r
WHERE ap.id = r.id
  AND r.rn > 1;

-- Enforce uniqueness for staged email ownership (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_profiles_unique_pending_email
  ON public.account_profiles ((lower(btrim(pending_email))))
  WHERE pending_email IS NOT NULL;

-- Keep only the earliest approved owner for duplicated verified ID hashes.
WITH ranked_verified_ids AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY id_number_hmac
      ORDER BY COALESCE(reviewed_at, submitted_at, created_at) ASC, id ASC
    ) AS rn
  FROM public.verification_steps
  WHERE step_type = 'id_doc'
    AND status = 'approved'
    AND id_number_hmac IS NOT NULL
)
UPDATE public.verification_steps vs
SET
  status = 'needs_resubmission',
  reason_code = COALESCE(vs.reason_code, 'id_number_duplicate'),
  reason_note = COALESCE(
    vs.reason_note,
    'ID number already verified on another account; resubmission required.'
  )
FROM ranked_verified_ids r
WHERE vs.id = r.id
  AND r.rn > 1;

-- Enforce verified-ID uniqueness globally.
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_steps_unique_approved_id_hmac
  ON public.verification_steps (id_number_hmac)
  WHERE step_type = 'id_doc'
    AND status = 'approved'
    AND id_number_hmac IS NOT NULL;

COMMIT;
