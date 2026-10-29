import "server-only";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { encryptData, decryptData } from "../utils/encryption";
import { uploadToR2, getR2ObjectBytes } from "../services/storage";
import { detectMimeFromMagicBytes } from "../utils/file-validation";
import { scanForMalware } from "../utils/malware-scan";
import { isReencodableImageType, reencodeImage } from "../utils/image-reencode";
import {
  validateSaIdChecksum,
  extractDobFromSaId,
  calculateAgeFromDob,
} from "../utils/sa-id-validation";
import { readStaffIdentityContext } from "./staff-identity";
import { foundationVerificationStatusSchema } from "./verification-status";
import { processIdentityNumber } from "../domains/verification/identity-processing";

const encryptedNumber = z.strictObject({
  ciphertext: z.string().regex(/^[a-f0-9]{26}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
  key_id: z.literal("identity-number-v1"),
});
export class FoundationVerificationError extends Error {
  constructor(
    readonly status: 400 | 403 | 409 | 413 | 503,
    message = "Verification could not be completed"
  ) {
    super(message);
  }
}
function secret(name: "HMAC_SECRET" | "ID_ENCRYPTION_KEY") {
  const value = process.env[name];
  if (!value || !/^[a-f0-9]{64}$/i.test(value) || new Set(value.toLowerCase()).size < 8)
    throw new FoundationVerificationError(503);
  return Buffer.from(value, "hex");
}
export async function readFoundationVerificationStatus(api: FoundationAuthenticatedApi) {
  const { data, error } = await api.rpc("get_my_verification_case", {});
  if (error) throw new FoundationVerificationError(503);
  return foundationVerificationStatusSchema.parse(data);
}
async function cleanEvidence(file: File, selfie: boolean) {
  if (!file.size || file.size > 5242880)
    throw new FoundationVerificationError(413, "Choose a file smaller than 5 MB");
  let bytes = Buffer.from(await file.arrayBuffer());
  const mime = detectMimeFromMagicBytes(bytes);
  if (
    !mime ||
    mime !== file.type ||
    !(isReencodableImageType(mime) || (!selfie && mime === "application/pdf")) ||
    !scanForMalware(bytes, mime).safe
  )
    throw new FoundationVerificationError(
      400,
      "Choose a clear JPEG, PNG or WebP image. ID documents may also be PDF."
    );
  if (isReencodableImageType(mime)) bytes = Buffer.from(await reencodeImage(bytes, mime));
  return bytes;
}
async function persistEvidence(
  api: FoundationAuthenticatedApi,
  service: FoundationServiceApi,
  owner: string,
  caseId: string,
  purpose: "id_front" | "selfie",
  bytes: Buffer
) {
  const reserved = await api.rpc("begin_evidence_upload", {
    p_case_id: caseId,
    p_purpose: purpose,
  });
  if (reserved.error)
    throw new FoundationVerificationError(reserved.error.code === "42501" ? 403 : 409);
  const artifact = z.object({ artifact_id: z.uuid() }).parse(reserved.data);
  const lookup = await service.rpc("evidence_upload_target", {
    p_owner: owner,
    p_artifact: artifact.artifact_id,
  });
  if (lookup.error) throw new FoundationVerificationError(409);
  const target = z
    .object({
      artifact_id: z.uuid(),
      case_id: z.uuid(),
      object_key: z.string().regex(/^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/),
      purpose: z.string(),
    })
    .parse(lookup.data);
  if (
    target.artifact_id !== artifact.artifact_id ||
    target.case_id !== caseId ||
    // SQL owns the opaque object identifier; it need not equal the artifact id.
    // The service lookup binds this key to the caller, case, artifact and purpose.
    !target.object_key.startsWith(`evidence/${caseId}/`) ||
    target.purpose !== purpose
  )
    throw new FoundationVerificationError(503);
  const encrypted = await encryptData(bytes);
  const stored = await uploadToR2({
    bucket: process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
    key: target.object_key,
    file: new Blob([new Uint8Array(encrypted).buffer]),
    contentType: "application/octet-stream",
  });
  if (stored.key !== target.object_key) throw new FoundationVerificationError(503);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const completed = await service.rpc("complete_evidence_upload", {
    p_artifact: artifact.artifact_id,
    p_stored_sha256: createHash("sha256").update(encrypted).digest("hex"),
    p_content_sha256: hash,
    p_size: encrypted.length,
  });
  const completion = z
    .object({
      artifact_id: z.uuid(),
      state: z.literal("clean"),
      case_version: z.number().int().positive(),
    })
    .safeParse(completed.data);
  if (
    completed.error ||
    !completion.success ||
    completion.data.artifact_id !== artifact.artifact_id
  )
    throw new FoundationVerificationError(503);
  return { id: artifact.artifact_id, hash, caseVersion: completion.data.case_version };
}
/** Only the GoTrue-verified caller supplies the owner. Typed numbers, risk,
 * receipts, encryption metadata and object paths are never accepted from JSON. */
export async function submitFoundationIdentity(
  api: FoundationAuthenticatedApi,
  service: FoundationServiceApi,
  owner: string,
  idNumber: string,
  document: File,
  selfie: File
) {
  if (!/^\d{13}$/.test(idNumber) || !validateSaIdChecksum(idNumber))
    throw new FoundationVerificationError(400, "Check the 13-digit South African ID number");
  const dob = extractDobFromSaId(idNumber);
  if (!dob || calculateAgeFromDob(dob) < 18)
    throw new FoundationVerificationError(400, "You must be at least 18 years old to register");
  const identity = processIdentityNumber(owner, idNumber, {
    identityMatchKey: secret("HMAC_SECRET").toString("hex"),
    numberEncryptionKey: secret("ID_ENCRYPTION_KEY").toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  });
  const fingerprint = identity.fingerprint;
  const [idBytes, faceBytes] = await Promise.all([
    cleanEvidence(document, false),
    cleanEvidence(selfie, true),
  ]);
  const assessment = await service.rpc("assess_identity_upload", {
    p_owner: owner,
    p_fingerprint: fingerprint,
    p_document_sha256: createHash("sha256").update(idBytes).digest("hex"),
    p_selfie_sha256: createHash("sha256").update(faceBytes).digest("hex"),
  });
  if (assessment.error) throw new FoundationVerificationError(503);
  const risk = z
    .object({ blocked: z.boolean(), risk_score: z.number().int().min(0).max(100) })
    .parse(assessment.data);
  if (risk.blocked)
    throw new FoundationVerificationError(
      403,
      "These identity details cannot be used for this submission. Contact support."
    );
  const opened = await api.rpc("open_verification_case", {});
  if (opened.error)
    throw new FoundationVerificationError(
      403,
      "Complete your legal names in your profile before submitting identity documents"
    );
  const current = z
    .object({ case_id: z.uuid(), version: z.number().int().positive(), read_only: z.boolean() })
    .parse(opened.data);
  if (current.read_only)
    throw new FoundationVerificationError(
      409,
      "This identity case is already accepted or under independent review"
    );
  const id = await persistEvidence(api, service, owner, current.case_id, "id_front", idBytes);
  const face = await persistEvidence(api, service, owner, current.case_id, "selfie", faceBytes);
  const receipt = randomUUID();
  const submitted = await service.rpc("register_identity_submission", {
    p_case: current.case_id,
    // Completion returns the version under the same database lock as the last
    // upload transition. Later changes must still conflict at registration.
    p_expected_version: face.caseVersion,
    p_id_artifact: id.id,
    p_selfie_artifact: face.id,
    p_fingerprint: fingerprint,
    p_identity_key: "identity-match-v1",
    p_encrypted_number: identity.encryptedNumber,
    p_receipt: receipt,
    p_risk_score: risk.risk_score,
  });
  if (submitted.error)
    throw new FoundationVerificationError(
      submitted.error.code === "PT409" ? 409 : 503,
      "The submission could not be confirmed. Refresh your verification status before trying again."
    );
  const accepted = z
    .strictObject({
      submission_id: z.uuid(),
      case_version: z.number().int().positive(),
      reused: z.boolean(),
    })
    .parse(submitted.data);
  if (accepted.case_version !== face.caseVersion + 1)
    throw new FoundationVerificationError(
      409,
      "The submission changed. Refresh your verification status before trying again."
    );
  return { submitted: true };
}
const reviewRequest = z.strictObject({
  case_id: z.uuid(),
  claim_generation: z.string().regex(/^[1-9]\d{0,18}$/),
  claim_nonce: z.uuid(),
});
const objectInfo = z.object({
  owner_id: z.uuid(),
  artifact_id: z.uuid(),
  object_key: z.string().regex(/^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size_bytes: z.number().int().positive().max(20000000),
  encrypted_number: encryptedNumber,
  claimed_names: z.object({
    first_name: z.string().min(1).max(400),
    last_name: z.string().min(1).max(400),
  }),
});
async function authorisedMetadata(
  api: FoundationAuthenticatedApi,
  input: z.infer<typeof reviewRequest>,
  artifactId: string
) {
  const { data, error } = await api.rpc("staff_evidence_metadata", {
    p_case_id: input.case_id,
    p_claim_generation: input.claim_generation,
    p_claim_nonce: input.claim_nonce,
    p_purpose: "routine_review",
  });
  if (error)
    throw new FoundationVerificationError(403, "Your evidence claim expired or permission changed");
  const metadata = z.object({ artifacts: z.array(z.object({ id: z.uuid() })) }).parse(data);
  if (!metadata.artifacts.some((item) => item.id === artifactId))
    throw new FoundationVerificationError(403);
}
export async function readFoundationReviewContext(
  api: FoundationAuthenticatedApi,
  service: FoundationServiceApi,
  value: unknown
) {
  const input = reviewRequest.parse(value);
  const context = await readStaffIdentityContext(api, input);
  await authorisedMetadata(api, input, context.id_artifact_id);
  const lookup = await service.rpc("evidence_review_object", {
    p_case: input.case_id,
    p_artifact: context.id_artifact_id,
  });
  if (lookup.error) throw new FoundationVerificationError(409);
  const artifact = objectInfo.parse(lookup.data),
    number = artifact.encrypted_number;
  if (
    artifact.artifact_id !== context.id_artifact_id ||
    !artifact.object_key.startsWith(`evidence/${input.case_id}/`)
  )
    throw new FoundationVerificationError(503);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secret("ID_ENCRYPTION_KEY"),
    Buffer.from(number.iv, "hex"),
    { authTagLength: 16 }
  );
  decipher.setAAD(Buffer.from(`${artifact.owner_id}:id_doc`, "utf8"));
  decipher.setAuthTag(Buffer.from(number.tag, "hex"));
  const claimedNumber = Buffer.concat([
    decipher.update(Buffer.from(number.ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
  if (!/^\d{13}$/.test(claimedNumber)) throw new FoundationVerificationError(503);
  const fresh = await readStaffIdentityContext(api, input);
  if (fresh.case_version !== context.case_version || fresh.submission_id !== context.submission_id)
    throw new FoundationVerificationError(409);
  await authorisedMetadata(api, input, context.id_artifact_id);
  return { ...context, claimed_number: claimedNumber, claimed_names: artifact.claimed_names };
}
export async function readFoundationEvidenceBytes(
  api: FoundationAuthenticatedApi,
  service: FoundationServiceApi,
  value: unknown,
  artifactId: string
) {
  const input = reviewRequest.parse(value);
  z.uuid().parse(artifactId);
  const context = await readStaffIdentityContext(api, input);
  if (![context.id_artifact_id, context.selfie_artifact_id].includes(artifactId))
    throw new FoundationVerificationError(403);
  const lookup = await service.rpc("evidence_review_object", {
    p_case: input.case_id,
    p_artifact: artifactId,
  });
  if (lookup.error) throw new FoundationVerificationError(409);
  const artifact = objectInfo.parse(lookup.data);
  if (
    artifact.artifact_id !== artifactId ||
    !artifact.object_key.startsWith(`evidence/${input.case_id}/`)
  )
    throw new FoundationVerificationError(503);
  const stored = await getR2ObjectBytes(
    process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
    artifact.object_key
  );
  if (
    !stored ||
    stored.bytes.length !== artifact.size_bytes ||
    createHash("sha256").update(stored.bytes).digest("hex") !== artifact.sha256
  )
    throw new FoundationVerificationError(503);
  const bytes = await decryptData(Buffer.from(stored.bytes));
  const mime = detectMimeFromMagicBytes(bytes);
  if (!mime || !(isReencodableImageType(mime) || mime === "application/pdf"))
    throw new FoundationVerificationError(503);
  await authorisedMetadata(api, input, artifactId);
  const fresh = await readStaffIdentityContext(api, input);
  if (fresh.case_version !== context.case_version || fresh.submission_id !== context.submission_id)
    throw new FoundationVerificationError(409);
  return { bytes: new Uint8Array(bytes).buffer, mime };
}
