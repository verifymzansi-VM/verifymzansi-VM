export interface EvidenceStep {
  id: string;
  step_type: string;
  status: string;
  risk_level: string | null;
  risk_score: number | null;
  auto_status: string | null;
  location_method: string | null;
  location_province: string | null;
  location_city: string | null;
  location_address_line: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  reason_code: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  first_name: string | null;
  last_name: string | null;
}

export interface Artifact {
  id: string;
  step_type: string;
  artifact_kind: string;
  r2_key: string;
  content_type: string;
  file_size_bytes: number;
  status: string;
  created_at: string;
  purge_after: string | null;
  sha256: string | null;
}

export interface ProviderResult {
  id: string;
  provider_name: string;
  check_type: string;
  raw_status: string;
  normalized_decision: string;
  created_at: string;
}

export interface RiskSignal {
  id: string;
  signal_type: string;
  severity: string;
  detail: string | null;
  created_at: string;
}

export interface AccessLog {
  id: string;
  actor_id: string;
  actor_role: string;
  artifact_id: string;
  ip_hash: string | null;
  accessed_at: string;
}

export interface AccountProfile {
  display_name: string;
  account_verification_status?: string | null;
  account_status: string;
  strikes: number;
  legal_hold: boolean;
  location_province: string | null;
  location_city: string | null;
}

export interface EvidenceMetadata {
  steps: EvidenceStep[];
  artifacts: Artifact[];
  providerResults: ProviderResult[];
  riskSignals: RiskSignal[];
  accountProfile?: AccountProfile | null;
  sellerProfile?: AccountProfile | null;
  accessLog: AccessLog[];
}
