import type { NativeIdentityScope } from "@/lib/admin/native-identity-review";

/**
 * Fixtures for the staff identity review screens on the foundation backend
 * (the evidence viewer, the KYC comparison viewer, the KYC queue and the
 * evidence decision controls).
 *
 * On foundation every evidence read is answered by
 * src/lib/foundation/restored-identity-metadata-route.ts or
 * src/lib/foundation/evidence-route.ts. Both stamp the response with
 * `X-VerifyMzansi-Actor`, the staff account the server served, and
 * `fetchStaffEvidence` (src/lib/auth/staff-evidence-fetch.ts) refuses the
 * response unless that is the account signed in in this browser. Tests mock
 * `@/lib/supabase/client` so `auth.getUser()` returns STAFF_ACTOR.
 */

/** Deterministic UUIDs (version 4, variant 8) for identity review fixtures. */
export const fixtureUuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;

/** The staff account signed in in this browser. */
export const STAFF_ACTOR = fixtureUuid(900);
/** Another staff account, e.g. after someone signs in as a colleague in another tab. */
export const OTHER_STAFF = fixtureUuid(901);
/** The member whose identity is under review. */
export const MEMBER = fixtureUuid(800);
export const ID_ARTIFACT = fixtureUuid(4);
export const SELFIE_ARTIFACT = fixtureUuid(5);
export const SUBJECT_LABEL = "Fixture Member · ID 8001015009087";
export const UPLOADED_AT = "2026-11-04T10:00:00Z";
export const STEP_UPDATED_AT = "2026-11-04T10:05:00.123456Z";

/** The claimed review a foundation response is fenced to (caseId is the claim id). */
export const REVIEW_SCOPE: NativeIdentityScope = {
  caseId: fixtureUuid(1),
  caseVersion: 7,
  submissionId: fixtureUuid(2),
  claimGeneration: "4",
  claimNonce: fixtureUuid(3),
};

type StepType = "id_doc" | "selfie";
const ARTIFACT_IDS: Record<StepType, string> = { id_doc: ID_ARTIFACT, selfie: SELFIE_ARTIFACT };

/**
 * One artifact as the foundation metadata route lists it: the content type and
 * size are unknown until the decrypted bytes have been inspected.
 */
export function identityArtifact(stepType: StepType, riskScore = 10) {
  return {
    id: ARTIFACT_IDS[stepType],
    step_type: stepType,
    artifact_kind: stepType === "id_doc" ? "id_front" : "selfie",
    r2_key: null,
    content_type: "application/octet-stream",
    file_size_bytes: null as number | null,
    status: "clean",
    created_at: UPLOADED_AT,
    purge_after: null as string | null,
    sha256: null,
    foundation: REVIEW_SCOPE,
    review_subject_label: SUBJECT_LABEL,
    review_risk_score: riskScore,
    review_risk_level: riskScore > 50 ? ("high" as const) : ("low" as const),
  };
}

/** One step as the foundation metadata route lists it for the evidence desk. */
export function identityStep(stepType: StepType, riskScore = 10) {
  return {
    id: ARTIFACT_IDS[stepType],
    user_id: MEMBER,
    claim_case_id: REVIEW_SCOPE.caseId,
    step_type: stepType,
    status: "pending",
    risk_level: riskScore > 50 ? "high" : "low",
    risk_score: riskScore,
    auto_status: "manual_review",
    reason_code: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: UPLOADED_AT,
    updated_at: STEP_UPDATED_AT,
    metadata: { submitted_id_number: "8001015009087" },
    foundation: REVIEW_SCOPE,
    review_subject_label: SUBJECT_LABEL,
  };
}

/**
 * The body of POST /api/admin/verification/evidence/metadata on foundation:
 * always one ID and one selfie, no provider results, and a single
 * "manual review only" signal that is not tied to either image.
 */
export function identityMetadata(riskScore = 10) {
  const artifacts = [identityArtifact("id_doc", riskScore), identityArtifact("selfie", riskScore)];
  return {
    account_id: STAFF_ACTOR,
    foundation: REVIEW_SCOPE,
    review_subject_label: SUBJECT_LABEL,
    artifacts,
    providerResults: [],
    riskSignals: [
      {
        id: REVIEW_SCOPE.submissionId,
        user_id: MEMBER,
        artifact_id: null,
        signal_code: "manual_review_only",
        severity: "info",
        value_json: { recipe: "sa_id_selfie", risk_score: riskScore },
        created_at: UPLOADED_AT,
      },
    ],
    accessLog: [],
    accountProfile: null,
    sellerProfile: null,
    steps: [identityStep("id_doc", riskScore), identityStep("selfie", riskScore)],
  };
}

/** A JSON answer from a staff evidence route, stamped with the served actor (null: unstamped). */
export function staffJson(
  body: unknown,
  { actor = STAFF_ACTOR, status = 200 }: { actor?: string | null; status?: number } = {}
) {
  return Response.json(body, {
    status,
    headers: actor ? { "X-VerifyMzansi-Actor": actor } : {},
  });
}

/** Decrypted evidence bytes from the evidence route, stamped with the served actor. */
export function staffEvidenceBytes(
  bytes: string,
  contentType: string,
  actor: string | null = STAFF_ACTOR
) {
  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      ...(actor ? { "X-VerifyMzansi-Actor": actor } : {}),
    },
  });
}
