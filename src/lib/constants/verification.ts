/* ══════════════════════════════════════════════════════════════
   VERIFICATION CONSTANTS
   Thresholds, templates, and limits used across verification flows.
   ══════════════════════════════════════════════════════════════ */

/* ── Manual Location Risk Scoring ─────────────────────────── */
export const MANUAL_ONLY_BASELINE_RISK = 20;

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
  "ID document appears to be expired — please provide a valid document.",
  "Name on ID does not match the name provided during registration.",
  "Photo quality is too low to verify — please upload a higher resolution image.",
] as const;

/* ── Provider Score Thresholds ───────────────────────────── */
export const FACE_MATCH_THRESHOLD = 70;
export const LIVENESS_THRESHOLD = 60;

/* ── SA ID Constants ─────────────────────────────────────── */
export const SA_ID_LENGTH = 13;
