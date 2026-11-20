import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { createFoundationServiceApi, type FoundationServiceApi } from "./service-api";
import { FoundationSessionError } from "./request-api";
import {
  cleanEvidence,
  verificationSecret,
  FoundationVerificationError,
} from "./verification-runtime";
import { processIdentityNumber } from "../domains/verification/identity-processing";
import {
  validateSaIdChecksum,
  extractDobFromSaId,
  calculateAgeFromDob,
} from "../utils/sa-id-validation";
import { normalizePersonName, isPersonName } from "./person-name";
import { readSelfieCaptureReport } from "./selfie-capture";
import { CAMERA_PHOTO_MESSAGES, cameraPhotoProblem } from "./camera-photo";
import { encryptData, decryptData } from "../utils/encryption";
import { putImmutableR2Bytes } from "../services/storage";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "../utils/rate-limit";
import { readBoundedRequestFormData, RequestBodyTooLargeError } from "../utils/request-body";
import { createLogger } from "../utils/logger";
import { logRequestFailure } from "../utils/request-failure";
import { foundationNoStore } from "@/lib/foundation/owner-route";
import { hasDatabaseReason } from "./error-reasons";
const log = createLogger("RestoredIdentityUpload");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const doneSchema = z.object({
  completed: z.literal(true),
  artifact_id: z.uuid(),
  purpose: z.enum(["id_front", "selfie"]),
});
const contextSchema = z.object({
  completed: z.literal(false),
  artifact_id: z.uuid(),
  case_id: z.uuid(),
  purpose: z.enum(["id_front", "selfie"]),
  object_key: z.string().regex(/^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/),
  fingerprint: z.string().nullable(),
  document_sha256: z.string().nullable(),
});
/** The encrypted ID number receipt the upload commands store (never the number). */
export const identityReceiptSchema = z.strictObject({
  fingerprint: z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/),
  encrypted_number: z.strictObject({
    ciphertext: z.string().regex(/^[a-f0-9]{26}$/),
    iv: z.string().regex(/^[a-f0-9]{24}$/),
    tag: z.string().regex(/^[a-f0-9]{32}$/),
    key_id: z.literal("identity-number-v1"),
  }),
});
export type IdentityReceipt = z.infer<typeof identityReceiptSchema>;
export function rpcFailure(error: { code?: string }): never {
  throw new FoundationVerificationError(
    error.code === "42501"
      ? 403
      : error.code === "PT409"
        ? 409
        : error.code === "22023"
          ? 400
          : 503,
    error.code === "PT409"
      ? "Your verification changed. Refresh the page before continuing."
      : "The upload could not be confirmed. Refresh your verification status before trying again."
  );
}

/** A refusal for a photo the page did not take with the camera (409, code camera_required). */
export class CameraRequiredError extends Error {
  override name = "CameraRequiredError";
  constructor(readonly problem: keyof typeof CAMERA_PHOTO_MESSAGES = "camera_required") {
    super(CAMERA_PHOTO_MESSAGES[problem]);
  }
}

/**
 * Refuses a photo the verification page did not take with its camera: the
 * browser must say "camera", and the file must look like the page's own
 * canvas JPEG (see camera-photo.ts). A server cannot prove a frame came from a
 * live camera; this only refuses what the page never sends.
 */
export async function assertCameraPhoto(
  file: File,
  captureMethod: FormDataEntryValue | null,
  purpose: "id_front" | "selfie"
) {
  if (captureMethod !== "camera") throw new CameraRequiredError();
  const problem = cameraPhotoProblem(new Uint8Array(await file.arrayBuffer()), purpose);
  if (problem) throw new CameraRequiredError(problem);
}

/**
 * Stores a reserved ID photo or selfie and completes it with the existing
 * service commands: the server's own risk assessment for a selfie, the
 * encrypted object write and its read-back, then completion. `beforeSelfie`
 * runs before anything is stored (the signed-in page records the browser's
 * capture report with the member's own session there). Returns false when the
 * identity details are blocked.
 */
export async function storeReservedVerificationUpload({
  service,
  ownerId,
  requestId,
  purpose,
  artifactId,
  bytes,
  identity,
  beforeSelfie,
}: {
  service: FoundationServiceApi;
  ownerId: string;
  requestId: string;
  purpose: "id_front" | "selfie";
  artifactId: string;
  bytes: Buffer;
  identity?: IdentityReceipt;
  beforeSelfie?: () => Promise<void>;
}): Promise<boolean> {
  const selfie = purpose === "selfie";
  const lookedUp = await service.rpc("frontend_verification_upload_context", {
    p_owner: ownerId,
    p_request: requestId,
  });
  if (lookedUp.error) rpcFailure(lookedUp.error);
  const complete = doneSchema.safeParse(lookedUp.data);
  if (complete.success) {
    if (complete.data.artifact_id !== artifactId || complete.data.purpose !== purpose)
      throw new Error("Upload receipt changed");
    return true;
  }
  const target = contextSchema.parse(lookedUp.data);
  if (
    target.artifact_id !== artifactId ||
    target.purpose !== purpose ||
    !target.object_key.startsWith(`evidence/${target.case_id}/`)
  )
    throw new Error("Upload target changed");
  let score: number | undefined;
  if (selfie) {
    await beforeSelfie?.();
    const fp = z
      .string()
      .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
      .parse(target.fingerprint);
    const documentHash = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(target.document_sha256);
    const assessed = await service.rpc("assess_identity_upload", {
      p_owner: ownerId,
      p_fingerprint: fp,
      p_document_sha256: documentHash,
      p_selfie_sha256: hash(bytes),
    });
    if (assessed.error) rpcFailure(assessed.error);
    const risk = z
      .object({ blocked: z.boolean(), risk_score: z.number().int().min(0).max(100) })
      .parse(assessed.data);
    if (risk.blocked) return false;
    score = risk.risk_score;
  } else if (!identity) throw new Error("ID upload without an identity receipt");
  const encrypted = await putImmutableR2Bytes(
    process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
    target.object_key,
    await encryptData(bytes)
  );
  const actual = await decryptData(encrypted);
  if (actual.length !== bytes.length || !timingSafeEqual(actual, bytes))
    throw new Error("Stored evidence does not match request");
  const finished = await service.rpc("complete_frontend_verification_upload", {
    p_owner: ownerId,
    p_request: requestId,
    p_stored_sha256: hash(encrypted),
    p_content_sha256: hash(bytes),
    p_size: encrypted.length,
    ...(identity && !selfie ? { p_identity: identity } : {}),
    ...(score !== undefined ? { p_risk_score: score } : {}),
  });
  if (finished.error) rpcFailure(finished.error);
  const saved = doneSchema.parse(finished.data);
  if (saved.artifact_id !== artifactId || saved.purpose !== purpose)
    throw new Error("Completed upload changed");
  return true;
}

/**
 * The typed ID number and legal names, checked as the ID upload checks them,
 * and the encrypted ID number receipt (the number itself never leaves this
 * server). Returns the member-facing reason when they are not usable.
 */
export function readIdentityDetails(
  accountId: string,
  rawNumber: unknown,
  rawFirst: unknown,
  rawLast: unknown
): { error: string } | { firstName: string; lastName: string; identity: IdentityReceipt } {
  if (
    typeof rawNumber !== "string" ||
    !/^\d{13}$/.test(rawNumber) ||
    !validateSaIdChecksum(rawNumber)
  )
    return { error: "Check the 13-digit South African ID number" };
  const dob = extractDobFromSaId(rawNumber);
  if (!dob || calculateAgeFromDob(dob) < 18)
    return { error: "You must be at least 18 years old to register" };
  const firstName = normalizePersonName(String(rawFirst ?? ""));
  const lastName = normalizePersonName(String(rawLast ?? ""));
  if (
    firstName.length > 400 ||
    lastName.length > 400 ||
    !isPersonName(firstName) ||
    !isPersonName(lastName)
  )
    return { error: "Enter the legal names on your ID document" };
  const processed = processIdentityNumber(accountId, rawNumber, {
    identityMatchKey: verificationSecret("HMAC_SECRET").toString("hex"),
    numberEncryptionKey: verificationSecret("ID_ENCRYPTION_KEY").toString("hex"),
    identityKeyId: "identity-match-v1",
    encryptionKeyId: "identity-number-v1",
  });
  return {
    firstName,
    lastName,
    identity: identityReceiptSchema.parse({
      fingerprint: processed.fingerprint,
      encrypted_number: processed.encryptedNumber,
    }),
  };
}

export const IDENTITY_BLOCKED_MESSAGE =
  "These identity details cannot be used for this submission. Contact support.";

export async function handleRestoredVerificationUpload(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch (error) {
    const reference = logRequestFailure(log, "Foundation binding unavailable", {
      request,
      error,
      action: "verification:upload",
    });
    return NextResponse.json(
      { error: "Verification uploads are temporarily unavailable", reference },
      { status: 503, headers: foundationNoStore }
    );
  }
  const reply = (status: number, error: string, reference?: string, code?: string) =>
    context.respond(
      NextResponse.json(
        { error, ...(code ? { code } : {}), ...(reference ? { reference } : {}) },
        { status }
      )
    );
  const apis: unknown[] = [];
  try {
    const ip = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "verification:upload",
      degradedMode: "block",
    });
    if (ip.degraded || ip.limited)
      return reply(
        ip.degraded ? 503 : 429,
        "Upload protection is unavailable or too many attempts were made"
      );
    const caller = await context.authenticateCaller();
    apis.push(caller.api);
    const limit = await checkRateLimit({
      key: caller.accountId,
      action: "verification:upload",
      degradedMode: "block",
    });
    if (limit.degraded || limit.limited)
      return reply(
        limit.degraded ? 503 : 429,
        "Upload protection is unavailable or too many attempts were made"
      );
    const form = await readBoundedRequestFormData(request, 5 * 1024 * 1024 + 16384);
    const allowed = [
      "file",
      "docType",
      "uploadRequestId",
      "idNumber",
      "firstName",
      "lastName",
      "idDocumentType",
      "captureMethod",
      "livenessPassed",
    ];
    if ([...form.keys()].some((key) => !allowed.includes(key) || form.getAll(key).length !== 1))
      return reply(400, "Choose one document and check your details");
    const requestId = z.uuid().safeParse(form.get("uploadRequestId"));
    const kind = z.enum(["id_document", "selfie"]).safeParse(form.get("docType"));
    const file = form.get("file");
    if (!requestId.success || !kind.success || !(file instanceof File))
      return reply(400, "Reload verification and choose one document");
    const selfie = kind.data === "selfie",
      purpose = selfie ? "selfie" : "id_front";
    let identity: IdentityReceipt | undefined;
    let firstName: string | undefined, lastName: string | undefined;
    const rawNumber = form.get("idNumber");
    if (!selfie) {
      const details = readIdentityDetails(
        caller.accountId,
        rawNumber,
        form.get("firstName"),
        form.get("lastName")
      );
      if ("error" in details) return reply(400, details.error);
      if (form.get("idDocumentType") !== "sa_id")
        return reply(400, "Use a South African ID document");
      ({ identity, firstName, lastName } = details);
    } else if (["idNumber", "firstName", "lastName", "idDocumentType"].some((key) => form.has(key)))
      return reply(400, "Choose a selfie without identity fields");
    // How the browser says the selfie was taken: stored for staff as review
    // context only (never authority), so it is checked against a closed set.
    const capture = selfie
      ? readSelfieCaptureReport(form.get("captureMethod"), form.get("livenessPassed"))
      : null;
    if (capture === "invalid") return reply(400, "Retake your selfie and try again");
    // Photos are taken with the camera on the page only (no file or gallery
    // upload). This refuses what the page never sends; it cannot prove a live
    // camera.
    await assertCameraPhoto(file, form.get("captureMethod"), purpose);
    const bytes = await cleanEvidence(file, selfie);
    // The digest binds every authoritative field and the original file, including
    // metadata stripped during normalization. It is not an identity fingerprint.
    const digest = createHmac("sha256", verificationSecret("HMAC_SECRET"))
      .update("wizard-upload-v1\0")
      .update(caller.accountId)
      .update(JSON.stringify([purpose, rawNumber, firstName, lastName, file.type]))
      .update(Buffer.from(await file.arrayBuffer()))
      .digest("hex");
    const reserved = await caller.api.rpc("reserve_frontend_verification_upload", {
      p_request: requestId.data,
      p_purpose: purpose,
      p_digest: digest,
      ...(!selfie ? { p_first_name: firstName!, p_last_name: lastName! } : {}),
    });
    if (reserved.error) rpcFailure(reserved.error);
    const artifact = z
      .object({ artifact_id: z.uuid(), completed: z.boolean() })
      .parse(reserved.data);
    const service = createFoundationServiceApi();
    apis.push(service);
    const stored = await storeReservedVerificationUpload({
      service,
      ownerId: caller.accountId,
      requestId: requestId.data,
      purpose,
      artifactId: artifact.artifact_id,
      bytes,
      identity,
      beforeSelfie: capture
        ? async () => {
            // Recorded with the member's own session, on their own selfie
            // receipt, before completion: review context for staff only.
            const recorded = await caller.api.rpc("record_my_selfie_capture", {
              p_request: requestId.data,
              p_capture_method: capture.captureMethod,
              p_browser_liveness_passed: capture.browserLivenessPassed,
            });
            if (recorded.error && hasDatabaseReason(recorded.error, "camera_required"))
              throw new CameraRequiredError();
            if (recorded.error) rpcFailure(recorded.error);
          }
        : undefined,
    });
    if (!stored) return reply(403, IDENTITY_BLOCKED_MESSAGE);
    return context.respond(
      NextResponse.json({
        success: true,
        artifactId: artifact.artifact_id,
        stepType: selfie ? "selfie" : "id_doc",
      })
    );
  } catch (error) {
    if (error instanceof FoundationSessionError)
      return reply(
        error.status,
        error.status === 401
          ? "Sign in to submit verification"
          : "Verification is temporarily unavailable"
      );
    if (error instanceof CameraRequiredError)
      return reply(409, error.message, undefined, "camera_required");
    if (error instanceof RequestBodyTooLargeError)
      return reply(413, "Choose a file smaller than 5 MB");
    if (error instanceof FoundationVerificationError) return reply(error.status, error.message);
    return reply(
      503,
      "The upload could not be confirmed. Refresh your verification status before trying again.",
      logRequestFailure(log, "Identity upload could not be confirmed", {
        request,
        error,
        api: apis,
        action: "verification:upload",
      })
    );
  }
}
