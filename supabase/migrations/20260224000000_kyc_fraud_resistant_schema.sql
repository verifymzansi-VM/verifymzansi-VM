-- VerifyMzansi KYC Fraud-Resistant Schema Extensions
-- Adds session tracking, provider result storage, risk signals, and evidence access audit.
-- Must be applied before any Phase 2+ application code is deployed.

-- ============================================================
-- 1. Extend kyc_artifacts
-- ============================================================

ALTER TABLE kyc_artifacts
  ADD COLUMN IF NOT EXISTS artifact_kind TEXT NOT NULL DEFAULT 'document'
    CHECK (artifact_kind IN ('document', 'selfie', 'proof_of_address', 'liveness_frame')),
  ADD COLUMN IF NOT EXISTS sha256 TEXT,
  ADD COLUMN IF NOT EXISTS provider_ref TEXT,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kyc_artifacts_purge
  ON kyc_artifacts(purge_after)
  WHERE purge_after IS NOT NULL;

-- ============================================================
-- 2. Extend verification_steps
-- ============================================================

ALTER TABLE verification_steps
  ADD COLUMN IF NOT EXISTS risk_level TEXT
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  ADD COLUMN IF NOT EXISTS risk_score INTEGER
    CHECK (risk_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS auto_status TEXT
    CHECK (auto_status IN ('pending', 'approved', 'rejected', 'needs_manual_review')),
  ADD COLUMN IF NOT EXISTS override_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS id_number_hmac TEXT;

CREATE INDEX IF NOT EXISTS idx_verification_steps_id_hmac
  ON verification_steps(id_number_hmac)
  WHERE id_number_hmac IS NOT NULL;

-- ============================================================
-- 3. New table: verification_sessions
-- One row per seller; UNIQUE(user_id) enforces a single
-- canonical in-progress session that the wizard can resume.
-- ============================================================

CREATE TABLE IF NOT EXISTS verification_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_verified_at TIMESTAMPTZ,
  id_artifact_id UUID REFERENCES kyc_artifacts(id) ON DELETE SET NULL,
  selfie_artifact_id UUID REFERENCES kyc_artifacts(id) ON DELETE SET NULL,
  location_submitted_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE verification_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own session"
  ON verification_sessions FOR SELECT
  USING (auth.uid() = user_id OR public.has_any_role(ARRAY['moderator', 'admin']));

CREATE POLICY "Owner writes own session"
  ON verification_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owner updates own session"
  ON verification_sessions FOR UPDATE
  USING (auth.uid() = user_id OR public.has_any_role(ARRAY['moderator', 'admin']));

CREATE TRIGGER set_verification_sessions_updated_at
  BEFORE UPDATE ON verification_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 4. New table: kyc_provider_results
-- Stores the structured result from the KYC provider (stub or real).
-- Human reviewers see these scores on the evidence desk.
-- ============================================================

CREATE TABLE IF NOT EXISTS kyc_provider_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES kyc_artifacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL DEFAULT 'stub',
  face_match_score NUMERIC(5, 2),
  liveness_score NUMERIC(5, 2),
  doc_auth_score NUMERIC(5, 2),
  ocr_payload JSONB NOT NULL DEFAULT '{}',
  raw_response JSONB NOT NULL DEFAULT '{}',
  provider_status TEXT NOT NULL,
  provider_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kyc_provider_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff reads provider results"
  ON kyc_provider_results FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));

CREATE INDEX IF NOT EXISTS idx_kyc_provider_results_artifact
  ON kyc_provider_results(artifact_id);

CREATE INDEX IF NOT EXISTS idx_kyc_provider_results_user
  ON kyc_provider_results(user_id);

CREATE INDEX IF NOT EXISTS idx_kyc_provider_results_ref
  ON kyc_provider_results(provider_ref)
  WHERE provider_ref IS NOT NULL;

-- ============================================================
-- 5. New table: kyc_risk_signals
-- One row per detected fraud/risk indicator per artifact.
-- signal_code values: duplicate_sha256 | velocity_resubmit |
--   id_number_reuse | gps_province_mismatch | gps_low_accuracy
-- ============================================================

CREATE TABLE IF NOT EXISTS kyc_risk_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_id UUID REFERENCES verification_steps(id) ON DELETE SET NULL,
  artifact_id UUID REFERENCES kyc_artifacts(id) ON DELETE SET NULL,
  signal_code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'block')),
  value_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kyc_risk_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff reads risk signals"
  ON kyc_risk_signals FOR SELECT
  USING (public.has_any_role(ARRAY['moderator', 'admin']));

CREATE INDEX IF NOT EXISTS idx_kyc_risk_signals_user
  ON kyc_risk_signals(user_id);

CREATE INDEX IF NOT EXISTS idx_kyc_risk_signals_step
  ON kyc_risk_signals(step_id)
  WHERE step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kyc_risk_signals_artifact
  ON kyc_risk_signals(artifact_id)
  WHERE artifact_id IS NOT NULL;

-- ============================================================
-- 6. New table: kyc_evidence_access_logs
-- Audits every admin/moderator view of a KYC document.
-- Only admins can read this table (not moderators).
-- ============================================================

CREATE TABLE IF NOT EXISTS kyc_evidence_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  actor_role TEXT NOT NULL,
  artifact_id UUID NOT NULL REFERENCES kyc_artifacts(id),
  user_id UUID NOT NULL,
  ip_hash TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kyc_evidence_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin reads evidence logs"
  ON kyc_evidence_access_logs FOR SELECT
  USING (public.has_role('admin'));

CREATE INDEX IF NOT EXISTS idx_kyc_evidence_access_actor
  ON kyc_evidence_access_logs(actor_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_kyc_evidence_access_artifact
  ON kyc_evidence_access_logs(artifact_id);
