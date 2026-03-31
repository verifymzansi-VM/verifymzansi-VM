-- Migration: Identity lock & contact-change cooldown schema
-- Adds legal name columns, cooldown timestamps, contact change history table,
-- first_name/last_name on verification_steps, and a DB trigger to enforce
-- immutable fields even if the API is bypassed.

-- ── 1. New columns on account_profiles ─────────────────────

ALTER TABLE public.account_profiles
  ADD COLUMN IF NOT EXISTS legal_first_name  TEXT,
  ADD COLUMN IF NOT EXISTS legal_last_name   TEXT,
  ADD COLUMN IF NOT EXISTS legal_name_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_last_phone_change_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_last_email_change_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_email     TEXT;

COMMENT ON COLUMN public.account_profiles.legal_first_name IS 'First name from verified ID document - immutable once set';
COMMENT ON COLUMN public.account_profiles.legal_last_name  IS 'Surname from verified ID document - immutable once set';
COMMENT ON COLUMN public.account_profiles.legal_name_locked_at IS 'Timestamp when legal name was locked from verified ID';
COMMENT ON COLUMN public.account_profiles.contact_last_phone_change_at IS 'Last time canonical phone was changed - used for 15-day cooldown';
COMMENT ON COLUMN public.account_profiles.contact_last_email_change_at IS 'Last time email was changed - used for 15-day cooldown';
COMMENT ON COLUMN public.account_profiles.pending_email IS 'Pending email change awaiting confirmation';

-- ── 2. New columns on verification_steps (first_name / last_name) ──

ALTER TABLE public.verification_steps
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name  TEXT;

COMMENT ON COLUMN public.verification_steps.first_name IS 'First name as printed on ID document';
COMMENT ON COLUMN public.verification_steps.last_name  IS 'Surname as printed on ID document';

-- ── 3. Contact change history table ────────────────────────

CREATE TABLE IF NOT EXISTS public.contact_change_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('phone', 'email')),
  old_value_hash TEXT,          -- SHA-256 of old value for audit without storing PII
  new_value_hash TEXT,          -- SHA-256 of new value
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at     TIMESTAMPTZ,   -- NULL until change is confirmed/applied
  source         TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'admin', 'system')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_change_history_user_type
  ON public.contact_change_history (user_id, change_type, applied_at DESC);

ALTER TABLE public.contact_change_history ENABLE ROW LEVEL SECURITY;

-- Owner can read own history
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contact_change_history' AND policyname = 'Owner reads own contact changes'
  ) THEN
    CREATE POLICY "Owner reads own contact changes"
      ON public.contact_change_history FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Service role inserts (application writes via admin client)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contact_change_history' AND policyname = 'Service role manages contact changes'
  ) THEN
    CREATE POLICY "Service role manages contact changes"
      ON public.contact_change_history FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Admin reads all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contact_change_history' AND policyname = 'Admin reads contact changes'
  ) THEN
    CREATE POLICY "Admin reads contact changes"
      ON public.contact_change_history FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = auth.uid()
            AND (u.raw_user_meta_data->>'role')::text = 'admin'
        )
      );
  END IF;
END $$;

-- ── 4. Defensive trigger: block illegal immutable-field updates ──

CREATE OR REPLACE FUNCTION public.enforce_identity_locks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Block name changes once legal name is locked
  IF OLD.legal_name_locked_at IS NOT NULL THEN
    IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
      RAISE EXCEPTION 'display_name is locked after identity verification'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.legal_first_name IS DISTINCT FROM OLD.legal_first_name THEN
      RAISE EXCEPTION 'legal_first_name is locked after identity verification'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.legal_last_name IS DISTINCT FROM OLD.legal_last_name THEN
      RAISE EXCEPTION 'legal_last_name is locked after identity verification'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Block province/city changes once location is verified
  IF OLD.location_verified_at IS NOT NULL THEN
    IF NEW.location_province IS DISTINCT FROM OLD.location_province THEN
      RAISE EXCEPTION 'location_province is locked after location verification'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.location_city IS DISTINCT FROM OLD.location_city THEN
      RAISE EXCEPTION 'location_city is locked after location verification'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_identity_locks ON public.account_profiles;
CREATE TRIGGER enforce_identity_locks
  BEFORE UPDATE ON public.account_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_identity_locks();
