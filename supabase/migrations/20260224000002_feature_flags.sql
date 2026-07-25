-- ══════════════════════════════════════════════════════════════
-- Feature Flags table — database-backed feature toggles
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Public can read flags (for client-side checks), only admin can modify
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read feature flags"
  ON public.feature_flags FOR SELECT
  USING (true);
CREATE POLICY "Admins can insert feature flags"
  ON public.feature_flags FOR INSERT
  WITH CHECK (
    (current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );
CREATE POLICY "Admins can update feature flags"
  ON public.feature_flags FOR UPDATE
  USING (
    (current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );
CREATE POLICY "Admins can delete feature flags"
  ON public.feature_flags FOR DELETE
  USING (
    (current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'role') = 'admin'
  );
-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_feature_flag_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION update_feature_flag_timestamp();
-- Seed initial flags
INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('kyc_v2_flow', false, 'Enable the new fraud-resistant KYC verification flow with session-driven orchestration'),
  ('kyc_gps_location', false, 'Enable GPS geolocation capture in the verification location step'),
  ('kyc_evidence_desk', false, 'Enable the admin evidence desk for side-by-side document review')
ON CONFLICT (key) DO NOTHING;
