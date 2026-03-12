/* ══════════════════════════════════════════════════════════════
   DATABASE ROW TYPES — mirrors Supabase PostgreSQL tables
   ══════════════════════════════════════════════════════════════ */

import type {
  MarketplaceArea,
  VerificationStepType,
  VerificationStatus,
  AccountVerificationStatus,
  DocumentType,
  LocationMethod,
  RiskLevel,
  RiskSignalSeverity,
  ArtifactKind,
  ListingStatus,
  ListingCategory,
  ListingCondition,
  ContactMethod,
  PlanTier,
  EntitlementType,
  EntitlementStatus,
  PaymentStatus,
  LeadStatus,
  ContactEventType,
  ReportCategory,
  ReportSeverity,
  ReportStatus,
  EnforcementAction,
  AccountStatus,
  CompatibleUserRole,
  DsarType,
  DsarStatus,
  BuyerTokenStatus,
  BusinessType,
  BusinessCategory,
  PromotionType,
} from "./enums";
import type { BusinessDetails } from "./business-details";

/* ── Account Profiles ─────────────────────────────────────── */
export interface AccountProfile {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  account_verification_status: AccountVerificationStatus;
  phone: string | null;
  masked_phone_public: string | null;
  location_province: string | null;
  location_city: string | null;
  location_verified_at: string | null;
  account_status: AccountStatus;
  strikes: number;
  suspended_until: string | null;
  banned_at: string | null;
  ban_reason: string | null;
  legal_hold: boolean;
  profile_completeness_score: number;
  created_at: string;
  updated_at: string;
}

/* ── Verification Steps ──────────────────────────────────── */
export interface VerificationStep {
  id: string;
  user_id: string;
  step_type: VerificationStepType;
  status: VerificationStatus;
  full_name: string | null;
  id_number_encrypted: string | null;
  id_number_iv: string | null;
  id_number_tag: string | null;
  id_number_hmac: string | null;
  dob: string | null;
  document_type: DocumentType | null;
  location_method: LocationMethod | null;
  gps_lat: number | null;
  gps_lon: number | null;
  location_province: string | null;
  location_city: string | null;
  location_town: string | null;
  phone_verified_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reason_code: string | null;
  reason_note: string | null;
  override_reason_code: string | null;
  risk_level: RiskLevel | null;
  risk_score: number | null;
  auto_status: "pending" | "approved" | "rejected" | "needs_manual_review" | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ── KYC Artifacts ───────────────────────────────────────── */
export interface KycArtifact {
  id: string;
  user_id: string;
  step_type: VerificationStepType;
  artifact_kind: ArtifactKind;
  r2_key: string;
  content_type: string;
  file_size_bytes: number;
  sha256: string | null;
  provider_ref: string | null;
  purge_after: string | null;
  status: VerificationStatus;
  created_at: string;
}

/* ── Verification Sessions ───────────────────────────────── */
export interface VerificationSession {
  id: string;
  user_id: string;
  phone_verified_at: string | null;
  id_artifact_id: string | null;
  selfie_artifact_id: string | null;
  location_submitted_at: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ── KYC Provider Results ────────────────────────────────── */
export interface KycProviderResult {
  id: string;
  artifact_id: string;
  user_id: string;
  provider_name: string;
  face_match_score: number | null;
  liveness_score: number | null;
  doc_auth_score: number | null;
  ocr_payload: Record<string, unknown>;
  raw_response: Record<string, unknown>;
  provider_status: string;
  provider_ref: string | null;
  created_at: string;
}

/* ── KYC Risk Signals ────────────────────────────────────── */
export interface KycRiskSignal {
  id: string;
  user_id: string;
  step_id: string | null;
  artifact_id: string | null;
  signal_code: string;
  severity: RiskSignalSeverity;
  value_json: Record<string, unknown>;
  created_at: string;
}

/* ── KYC Evidence Access Logs ────────────────────────────── */
export interface KycEvidenceAccessLog {
  id: string;
  actor_id: string;
  actor_role: string;
  artifact_id: string;
  user_id: string;
  ip_hash: string | null;
  accessed_at: string;
}

/* ── Plans ───────────────────────────────────────────────── */
export interface Plan {
  id: string;
  area: MarketplaceArea;
  tier: PlanTier;
  name: string;
  price_cents: number;
  billing_frequency: string;
  features: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

/* ── Entitlements ────────────────────────────────────────── */
export interface Entitlement {
  id: string;
  user_id: string;
  area: MarketplaceArea;
  tier: PlanTier;
  type: EntitlementType;
  status: EntitlementStatus;
  payfast_subscription_id: string | null;
  started_at: string;
  expires_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Listings (Mzansi Market) ────────────────────────────── */
export interface Listing {
  id: string;
  owner_id: string;
  area: MarketplaceArea;
  category: ListingCategory;
  condition: ListingCondition | null;
  title: string;
  description: string;
  photos: string[];
  videos: string[];
  video_thumbnail: string | null;
  price_cents: number | null;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  location_suburb: string | null;
  contact_methods: ContactMethod[];
  buyer_verification_required: boolean;
  attributes: Record<string, unknown>;
  status: ListingStatus;
  status_reason: string | null;
  entitlement_id: string | null;
  boost_until: string | null;
  featured_until: string | null;
  urgent_until: string | null;
  featured: boolean;
  urgent: boolean;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Businesses (Mzansi Business — unified) ────────────── */
export interface Business {
  id: string;
  owner_id: string;
  area: MarketplaceArea;
  business_type: BusinessType;
  business_name: string;
  slug: string;
  description: string;
  category: BusinessCategory;
  logo_url: string | null;
  cover_photo: string | null;
  cover_video: string | null;
  video_thumbnail: string | null;
  gallery_photos: string[] | null;
  location_province: string;
  location_city: string;
  store_number: string | null;
  map_directions: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  social_links: Record<string, string> | null;
  services_offered: string[];
  service_areas: Record<string, unknown> | null;
  business_details: BusinessDetails | null;
  operating_hours: Record<string, unknown>;
  payment_methods_accepted: string[];
  delivery_options: string[];
  status: ListingStatus;
  status_reason: string | null;
  entitlement_id: string | null;
  boost_until: string | null;
  featured_until: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Promotions ─────────────────────────────────────────── */
export interface Promotion {
  id: string;
  owner_id: string;
  business_id: string | null;
  title: string;
  description: string;
  promotion_type: PromotionType;
  category: string | null;
  category_key: BusinessCategory | null;
  photos: string[];
  videos: string[];
  video_thumbnail: string | null;
  price_cents: number | null;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  contact_methods: ContactMethod[];
  start_date: string | null;
  end_date: string | null;
  status: ListingStatus;
  status_reason: string | null;
  boost_until: string | null;
  featured_until: string | null;
  view_count: number;
  click_count: number;
  entitlement_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Payments ────────────────────────────────────────────── */
export interface Payment {
  id: string;
  user_id: string;
  entitlement_id: string | null;
  area: MarketplaceArea;
  amount_cents: number;
  status: PaymentStatus;
  payfast_payment_id: string | null;
  payfast_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/* ── Invoices ────────────────────────────────────────────── */
export interface Invoice {
  id: string;
  invoice_number: string;
  user_id: string;
  payment_id: string;
  amount_cents: number;
  vat_cents: number;
  total_cents: number;
  description: string;
  pdf_url: string | null;
  created_at: string;
}

/* ── Leads ───────────────────────────────────────────────── */
export interface Lead {
  id: string;
  target_id: string;
  target_type: "listing" | "storefront" | "business_profile" | "business";
  owner_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  message: string;
  status: LeadStatus;
  created_at: string;
  updated_at: string;
}

/* ── Contact Events ──────────────────────────────────────── */
export interface ContactEvent {
  id: string;
  target_id: string;
  target_type: string;
  owner_id: string;
  member_verified: boolean;
  contact_type: ContactEventType;
  created_at: string;
}

/* ── Reports ─────────────────────────────────────────────── */
export interface Report {
  id: string;
  target_id: string;
  target_type: string;
  area: MarketplaceArea;
  category: ReportCategory;
  severity: ReportSeverity;
  description: string;
  screenshot_url: string | null;
  reporter_user_id: string | null;
  reporter_ip_hash: string;
  status: ReportStatus;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Moderation Actions ──────────────────────────────────── */
export interface ModerationAction {
  id: string;
  report_id: string;
  actor_id: string;
  action: EnforcementAction;
  target_owner_id: string;
  area: MarketplaceArea;
  reason: string;
  duration_days: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/* ── Audit Logs ──────────────────────────────────────────── */
export interface AuditLog {
  id: string;
  actor_id: string;
  actor_role: CompatibleUserRole;
  action: string;
  target_type: string;
  target_id: string;
  area: MarketplaceArea | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/* ── OTP Logs ────────────────────────────────────────────── */
export interface OtpLog {
  id: string;
  phone: string;
  otp_hash: string;
  expires_at: string;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
}

/* ── OTP Challenges ──────────────────────────────────────── */
export interface OtpChallenge {
  id: string;
  user_id: string;
  phone: string;
  otp_hash: string;
  expires_at: string;
  attempt_count: number;
  locked_until: string | null;
  verified_at: string | null;
  created_at: string;
}

/* ── Buyer Verifications ─────────────────────────────────── */
export interface BuyerVerification {
  id: string;
  phone: string;
  phone_verified: boolean;
  first_name_initial: string | null;
  kyc_artifact_ids: string[];
  token: string;
  status: BuyerTokenStatus;
  issued_at: string;
  expires_at: string;
  created_at: string;
}

/* ── DSAR Cases ──────────────────────────────────────────── */
export interface DsarCase {
  id: string;
  type: DsarType;
  requester_email: string;
  requester_phone: string;
  identity_verified: boolean;
  description: string;
  status: DsarStatus;
  due_by: string;
  completed_at: string | null;
  response_summary: string | null;
  processed_by: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Consent Records ─────────────────────────────────────── */
export interface ConsentRecord {
  id: string;
  user_id: string;
  consent_type: string;
  version: string;
  granted: boolean;
  ip_hash: string | null;
  created_at: string;
}

/* ── Listing Views ───────────────────────────────────────── */
export interface ListingView {
  id: string;
  target_id: string;
  target_type: string;
  viewer_ip_hash: string | null;
  viewer_user_id: string | null;
  created_at: string;
}

/* ── Feature Flags ───────────────────────────────────────── */
export type FeatureFlagMode = "off" | "on" | "percent" | "allowlist";

export interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
  mode: FeatureFlagMode | null;
  rollout_percent: number | null;
  allowlist_roles: string[] | null;
  updated_by: string | null;
  updated_reason: string | null;
  created_at: string;
  updated_at: string;
}
