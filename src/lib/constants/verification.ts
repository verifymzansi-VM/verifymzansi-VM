/* ══════════════════════════════════════════════════════════════
   VERIFICATION CONSTANTS
   Thresholds, templates, and limits used across verification flows.
   ══════════════════════════════════════════════════════════════ */

/* ── GPS / Location ──────────────────────────────────────── */
export const GPS_ACCURACY_WARN_METERS = 1000;
export const GPS_ACCURACY_REJECT_METERS = 3000;
export const GPS_REQUEST_TIMEOUT_MS = 15_000;
export const GPS_MAX_AGE_MS = 60_000;
export const GPS_REPLAY_REJECT_MS = 5 * 60_000; // 5 min — hard-reject stale/replayed readings

/* ── Manual Location Risk Scoring ─────────────────────────── */
export const MANUAL_ONLY_BASELINE_RISK = 20;
export const GPS_PROVINCE_MISMATCH_RISK = 50;
export const GPS_CITY_MISMATCH_RISK = 25;

/* ── Image Quality Requirements ──────────────────────────── */
export const MIN_IMAGE_DIMENSION = 320;
export const MAX_IMAGE_DIMENSION = 8000;
export const BLUR_VARIANCE_THRESHOLD = 100;

/* ── Verification Steps ──────────────────────────────────── */
export const REQUIRED_VERIFICATION_STEPS = ["phone", "id_doc", "selfie", "location"] as const;

/* ── Decision Reason Codes ───────────────────────────────── */
export const REASON_CODES = [
  "blurry_image",
  "mismatch",
  "expired_document",
  "incomplete_info",
  "fraudulent",
  "wrong_document_type",
  "not_sa_document",
  "location_mismatch",
  "high_risk_override",
  "other",
] as const;

type _ReasonCode = (typeof REASON_CODES)[number];

/* ── Override Reason Codes (for high-risk approvals) ─────── */
export const OVERRIDE_REASON_CODES = [
  "verified_in_person",
  "known_customer",
  "false_positive",
  "escalated_review",
  "supporting_evidence",
] as const;

type _OverrideReasonCode = (typeof OVERRIDE_REASON_CODES)[number];

/* ── Decision Note Templates ─────────────────────────────── */
export const DECISION_NOTE_TEMPLATES = [
  "Document edges are cut off — please retake the photo showing the full document.",
  "Face is not clearly visible in selfie — ensure good lighting and remove sunglasses/hat.",
  "Address on proof does not match declared province — please upload correct document.",
  "ID document appears to be expired — please provide a valid document.",
  "Name on ID does not match the name provided during registration.",
  "Photo quality is too low to verify — please upload a higher resolution image.",
  "GPS location does not match declared province — please verify your location.",
] as const;

/* ── Provider Score Thresholds ───────────────────────────── */
export const FACE_MATCH_THRESHOLD = 70;
export const LIVENESS_THRESHOLD = 60;

/* ── SA ID Constants ─────────────────────────────────────── */
export const SA_ID_LENGTH = 13;

/* ── Nominatim / Geocoding ───────────────────────────────── */
export const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org";
export const GEOCODING_REQUEST_TIMEOUT_MS = 5_000;
