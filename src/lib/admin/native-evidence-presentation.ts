import { getDataBackend } from "../data-backend";
import { nativeIdentityScopeSchema, type NativeIdentityScope } from "./native-identity-review";
export type NativeEvidenceFields = {
  foundation?: NativeIdentityScope;
  review_subject_label?: string;
  review_risk_score?: number;
  review_risk_level?: "low" | "high";
};
export function formatEvidenceBytes(bytes: number | null): string {
  if (bytes === null) return "Not yet loaded";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function nativeEvidenceBody(artifact: { id: string } & NativeEvidenceFields) {
  if (getDataBackend() !== "foundation") return { artifactId: artifact.id };
  return {
    artifactId: artifact.id,
    foundation: nativeIdentityScopeSchema.parse(artifact.foundation),
  };
}
/** Called only by the existing explicit confirmation controls. Approval of an
 * ID attests its submitted number/details; approval of a selfie attests the
 * portrait match. SQL combines both current, same-reviewer step receipts. */
export function confirmedIdentityDecisionFields(step: NativeEvidenceFields, decision: string) {
  if (getDataBackend() !== "foundation") return {};
  return {
    foundation: nativeIdentityScopeSchema.parse(step.foundation),
    ...(decision === "approved" ? { stepMatches: true } : {}),
  };
}
export function identityApprovalMessage(step: NativeEvidenceFields & { step_type: string }) {
  if (!step.foundation)
    return "This will mark the step as approved. If all verification steps are approved, the account will be verified.";
  return `Confirm that ${step.step_type === "id_doc" ? "the ID number and legal name match the submitted details" : "the selfie matches the ID portrait"}${step.review_subject_label ? `: ${step.review_subject_label}` : "."} Both current step approvals are required; high-risk submissions need an independent second reviewer.`;
}
/** The private stream identifies inspected bytes. Metadata never guesses an
 * image/PDF MIME or plaintext size from encrypted object metadata. */
export function inspectedEvidenceArtifact<
  T extends { content_type: string; file_size_bytes: number | null },
>(artifact: T, blob: Blob): T {
  if (["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(blob.type))
    return { ...artifact, content_type: blob.type, file_size_bytes: blob.size };
  if (getDataBackend() === "foundation")
    throw new Error("The evidence format could not be confirmed.");
  return artifact;
}
