import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { createFoundationServiceApi } from "./service-api";
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
import { encryptData, decryptData } from "../utils/encryption";
import { putImmutableR2Bytes } from "../services/storage";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "../utils/rate-limit";
import { readBoundedRequestFormData, RequestBodyTooLargeError } from "../utils/request-body";
import { createLogger } from "../utils/logger";
import { foundationNoStore } from "@/lib/foundation/owner-route";
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
function rpcFailure(error: { code?: string }) {
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
export async function handleRestoredVerificationUpload(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return NextResponse.json(
      { error: "Verification uploads are temporarily unavailable" },
      { status: 503, headers: foundationNoStore }
    );
  }
  const reply = (status: number, error: string) =>
    context.respond(NextResponse.json({ error }, { status }));
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
    let identity: ReturnType<typeof processIdentityNumber> | undefined;
    let firstName: string | undefined, lastName: string | undefined;
    const rawNumber = form.get("idNumber");
    if (!selfie) {
      if (
        typeof rawNumber !== "string" ||
        !/^\d{13}$/.test(rawNumber) ||
        !validateSaIdChecksum(rawNumber)
      )
        return reply(400, "Check the 13-digit South African ID number");
      const dob = extractDobFromSaId(rawNumber);
      if (!dob || calculateAgeFromDob(dob) < 18)
        return reply(400, "You must be at least 18 years old to register");
      if (form.get("idDocumentType") !== "sa_id")
        return reply(400, "Use a South African ID document");
      firstName = normalizePersonName(String(form.get("firstName") ?? ""));
      lastName = normalizePersonName(String(form.get("lastName") ?? ""));
      if (
        firstName.length > 400 ||
        lastName.length > 400 ||
        !isPersonName(firstName) ||
        !isPersonName(lastName)
      )
        return reply(400, "Enter the legal names on your ID document");
      identity = processIdentityNumber(caller.accountId, rawNumber, {
        identityMatchKey: verificationSecret("HMAC_SECRET").toString("hex"),
        numberEncryptionKey: verificationSecret("ID_ENCRYPTION_KEY").toString("hex"),
        identityKeyId: "identity-match-v1",
        encryptionKeyId: "identity-number-v1",
      });
    } else if (["idNumber", "firstName", "lastName", "idDocumentType"].some((key) => form.has(key)))
      return reply(400, "Choose a selfie without identity fields");
    // How the browser says the selfie was taken: stored for staff as review
    // context only (never authority), so it is checked against a closed set.
    const capture = selfie
      ? readSelfieCaptureReport(form.get("captureMethod"), form.get("livenessPassed"))
      : null;
    if (capture === "invalid") return reply(400, "Retake your selfie and try again");
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
    const lookedUp = await service.rpc("frontend_verification_upload_context", {
      p_owner: caller.accountId,
      p_request: requestId.data,
    });
    if (lookedUp.error) rpcFailure(lookedUp.error);
    const complete = doneSchema.safeParse(lookedUp.data);
    if (complete.success) {
      if (complete.data.artifact_id !== artifact.artifact_id || complete.data.purpose !== purpose)
        throw new Error("Upload receipt changed");
    } else {
      const target = contextSchema.parse(lookedUp.data);
      if (
        target.artifact_id !== artifact.artifact_id ||
        target.purpose !== purpose ||
        !target.object_key.startsWith(`evidence/${target.case_id}/`)
      )
        throw new Error("Upload target changed");
      let score: number | undefined;
      if (selfie) {
        const fp = z
          .string()
          .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)
          .parse(target.fingerprint);
        const documentHash = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(target.document_sha256);
        const assessed = await service.rpc("assess_identity_upload", {
          p_owner: caller.accountId,
          p_fingerprint: fp,
          p_document_sha256: documentHash,
          p_selfie_sha256: hash(bytes),
        });
        if (assessed.error) rpcFailure(assessed.error);
        const risk = z
          .object({ blocked: z.boolean(), risk_score: z.number().int().min(0).max(100) })
          .parse(assessed.data);
        if (risk.blocked)
          return reply(
            403,
            "These identity details cannot be used for this submission. Contact support."
          );
        score = risk.risk_score;
      }
      const encrypted = await putImmutableR2Bytes(
        process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
        target.object_key,
        await encryptData(bytes)
      );
      const actual = await decryptData(encrypted);
      if (actual.length !== bytes.length || !timingSafeEqual(actual, bytes))
        throw new Error("Stored evidence does not match request");
      const finished = await service.rpc("complete_frontend_verification_upload", {
        p_owner: caller.accountId,
        p_request: requestId.data,
        p_stored_sha256: hash(encrypted),
        p_content_sha256: hash(bytes),
        p_size: encrypted.length,
        ...(identity
          ? {
              p_identity: {
                fingerprint: identity.fingerprint,
                encrypted_number: identity.encryptedNumber,
              },
            }
          : {}),
        ...(score !== undefined ? { p_risk_score: score } : {}),
        ...(capture
          ? {
              p_capture_method: capture.captureMethod,
              p_browser_liveness_passed: capture.browserLivenessPassed,
            }
          : {}),
      });
      if (finished.error) rpcFailure(finished.error);
      const saved = doneSchema.parse(finished.data);
      if (saved.artifact_id !== artifact.artifact_id || saved.purpose !== purpose)
        throw new Error("Completed upload changed");
    }
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
    if (error instanceof RequestBodyTooLargeError)
      return reply(413, "Choose a file smaller than 5 MB");
    if (error instanceof FoundationVerificationError) return reply(error.status, error.message);
    log.error("Identity upload could not be confirmed");
    return reply(
      503,
      "The upload could not be confirmed. Refresh your verification status before trying again."
    );
  }
}
