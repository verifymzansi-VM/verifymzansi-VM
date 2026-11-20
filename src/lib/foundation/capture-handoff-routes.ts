import "server-only";
import { createHmac } from "node:crypto";
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
import {
  assertCameraPhoto,
  CameraRequiredError,
  IDENTITY_BLOCKED_MESSAGE,
  identityReceiptSchema,
  rpcFailure,
  storeReservedVerificationUpload,
} from "./restored-verification-upload";
import {
  CAPTURE_GRANT_COOKIE,
  CAPTURE_GRANT_COOKIE_PATH,
  captureHandoffStateSchema,
  handoffLink,
  handoffQrCode,
  handoffSecretSchema,
  newHandoffSecret,
  phoneHandoffView,
  sha256Hex,
} from "./capture-handoff";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "../utils/rate-limit";
import { readBoundedRequestFormData, RequestBodyTooLargeError } from "../utils/request-body";
import { createLogger } from "../utils/logger";
import { logRequestFailure } from "../utils/request-failure";
import { foundationNoStore } from "@/lib/foundation/owner-route";
import { hasDatabaseReason } from "./error-reasons";

const log = createLogger("CaptureHandoff");

/** Member-facing answers (no provider, no internal detail). */
const HANDOFF_MESSAGES = {
  unavailable:
    "This link has expired or was already used. On your computer, choose New code and scan it again.",
  otherAccount:
    "This phone is signed in to a different account. Sign out on this phone first, or sign in to your own account here and open Get verified.",
  rateLimited: "You've made 5 phone links in the last hour. Please try again later.",
  needsId: "Enter your names and ID number first, then continue on your phone.",
  busy: "Please wait a moment and try again.",
  failed: "We couldn't make a phone link right now. Please try again.",
} as const;

type HandoffError = { code?: string; details?: string | null; message?: string };

function noStore(response: NextResponse) {
  for (const [name, value] of Object.entries(foundationNoStore)) response.headers.set(name, value);
  return response;
}
const answer = (status: number, body: Record<string, unknown>) =>
  noStore(NextResponse.json(body, { status }));

async function limited(key: string, action: string) {
  const result = await checkRateLimit({ key, action, degradedMode: "block" });
  return result.degraded || result.limited ? (result.degraded ? 503 : 429) : null;
}

function connection(request: NextRequest, action: string) {
  try {
    return createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch (error) {
    logRequestFailure(log, "Foundation binding unavailable", { request, error, action });
    return null;
  }
}

const startBody = z.union([
  z.strictObject({}),
  z.strictObject({
    idNumber: z.string().regex(/^\d{13}$/),
    firstName: z.string().min(1).max(400),
    lastName: z.string().min(1).max(400),
  }),
]);

/**
 * POST /api/verification/handoff: the signed-in computer asks for a
 * "Continue on your phone" link. With the names and ID number typed on the
 * computer, the phone takes the ID photo and the selfie; without them, only
 * the selfie (after an ID photo of the case). Answers the QR code only.
 */
export async function handleStartCaptureHandoff(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const context = connection(request, "verification:handoff");
  if (!context) return answer(503, { error: HANDOFF_MESSAGES.failed });
  const reply = (status: number, body: Record<string, unknown>) =>
    context.respond(NextResponse.json(body, { status }));
  try {
    const ip = await limited(getClientRateLimitIdentity(request).key, "verification:handoff");
    if (ip) return reply(ip, { error: HANDOFF_MESSAGES.busy });
    const caller = await context.authenticateCaller();
    const own = await limited(caller.accountId, "verification:handoff");
    if (own) return reply(own, { error: HANDOFF_MESSAGES.busy });
    const raw = await request.json().catch(() => null);
    const body = startBody.safeParse(raw);
    if (!body.success) return reply(400, { error: HANDOFF_MESSAGES.needsId });
    let names: { first: string; last: string } | undefined;
    let identity: z.infer<typeof identityReceiptSchema> | undefined;
    if ("idNumber" in body.data) {
      const { idNumber } = body.data;
      if (!validateSaIdChecksum(idNumber))
        return reply(400, { error: "Check the 13-digit South African ID number" });
      const dob = extractDobFromSaId(idNumber);
      if (!dob || calculateAgeFromDob(dob) < 18)
        return reply(400, { error: "You must be at least 18 years old to register" });
      const first = normalizePersonName(body.data.firstName);
      const last = normalizePersonName(body.data.lastName);
      if (!isPersonName(first) || !isPersonName(last))
        return reply(400, { error: "Enter the legal names on your ID document" });
      names = { first, last };
      const processed = processIdentityNumber(caller.accountId, idNumber, {
        identityMatchKey: verificationSecret("HMAC_SECRET").toString("hex"),
        numberEncryptionKey: verificationSecret("ID_ENCRYPTION_KEY").toString("hex"),
        identityKeyId: "identity-match-v1",
        encryptionKeyId: "identity-number-v1",
      });
      identity = identityReceiptSchema.parse({
        fingerprint: processed.fingerprint,
        encrypted_number: processed.encryptedNumber,
      });
    }
    const token = newHandoffSecret();
    const started = await caller.api.rpc("start_capture_handoff", {
      p_token_sha256: sha256Hex(token),
      ...(names && identity
        ? { p_first_name: names.first, p_last_name: names.last, p_identity: identity }
        : {}),
    });
    if (started.error) {
      const error = started.error as HandoffError;
      if (error.code === "PT429") return reply(429, { error: HANDOFF_MESSAGES.rateLimited });
      if (hasDatabaseReason(error, "handoff_needs_id"))
        return reply(409, { error: HANDOFF_MESSAGES.needsId, code: "handoff_needs_id" });
      rpcFailure(error);
    }
    const made = z
      .object({ expires_at: z.string().min(1), needs_id: z.boolean() })
      .parse(started.data);
    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";
    return reply(200, {
      qr: handoffQrCode(handoffLink(origin, token)),
      expiresAt: made.expires_at,
      needsId: made.needs_id,
    });
  } catch (error) {
    if (error instanceof FoundationSessionError)
      return reply(error.status, {
        error: error.status === 401 ? "Sign in to continue verification" : HANDOFF_MESSAGES.failed,
      });
    if (error instanceof FoundationVerificationError)
      return reply(error.status, { error: error.message });
    return reply(503, {
      error: HANDOFF_MESSAGES.failed,
      reference: logRequestFailure(log, "Phone link could not be made", {
        request,
        error,
        action: "verification:handoff",
      }),
    });
  }
}

function setGrantCookie(response: NextResponse, grant: string, expiresAt: string) {
  const seconds = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
  response.cookies.set(CAPTURE_GRANT_COOKIE, grant, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: CAPTURE_GRANT_COOKIE_PATH,
    maxAge: Math.max(1, Math.min(900, seconds)),
  });
}
function clearGrantCookie(response: NextResponse) {
  response.cookies.set(CAPTURE_GRANT_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: CAPTURE_GRANT_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}

/**
 * POST /api/handoff/open: the phone opens a link (the token from
 * the #fragment, in the body). Single use; a phone signed in as another
 * account is refused. Sets the capture grant cookie.
 */
export async function handleOpenCaptureHandoff(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const context = connection(request, "verification:handoff-open");
  if (!context) return answer(503, { error: HANDOFF_MESSAGES.failed });
  const reply = (status: number, body: Record<string, unknown>) =>
    context.respond(NextResponse.json(body, { status }));
  try {
    const ip = await limited(getClientRateLimitIdentity(request).key, "verification:handoff-open");
    if (ip) return reply(ip, { error: HANDOFF_MESSAGES.busy });
    const body = z
      .strictObject({ token: handoffSecretSchema })
      .safeParse(await request.json().catch(() => null));
    if (!body.success)
      return reply(409, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" });
    // A phone already signed in must be signed in as the link's owner.
    let signedIn: string | null = null;
    try {
      signedIn = (await context.authenticateCaller()).accountId;
    } catch (error) {
      if (!(error instanceof FoundationSessionError) || error.status !== 401) throw error;
    }
    const grant = newHandoffSecret();
    const service = createFoundationServiceApi();
    const opened = await service.rpc("redeem_capture_handoff", {
      p_token_sha256: sha256Hex(body.data.token),
      p_grant_sha256: sha256Hex(grant),
      ...(signedIn ? { p_signed_in: signedIn } : {}),
    });
    if (opened.error) {
      const error = opened.error as HandoffError;
      if (hasDatabaseReason(error, "handoff_other_account"))
        return reply(403, { error: HANDOFF_MESSAGES.otherAccount, code: "handoff_other_account" });
      if (error.code === "PT409" || error.code === "22023")
        return reply(409, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" });
      rpcFailure(error);
    }
    const state = captureHandoffStateSchema.parse(opened.data);
    const response = await reply(200, phoneHandoffView(state));
    setGrantCookie(response, grant, state.expires_at);
    return response;
  } catch (error) {
    if (error instanceof FoundationSessionError)
      return reply(503, { error: HANDOFF_MESSAGES.failed });
    return reply(503, {
      error: HANDOFF_MESSAGES.failed,
      reference: logRequestFailure(log, "Phone link could not be opened", {
        request,
        error,
        action: "verification:handoff-open",
      }),
    });
  }
}

function readGrant(request: NextRequest) {
  const parsed = handoffSecretSchema.safeParse(request.cookies.get(CAPTURE_GRANT_COOKIE)?.value);
  return parsed.success ? parsed.data : null;
}

async function grantState(service: FoundationServiceApi, grant: string) {
  const state = await service.rpc("capture_handoff_context", { p_grant_sha256: sha256Hex(grant) });
  if (state.error) {
    if (state.error.code === "PT409" || state.error.code === "22023") return null;
    rpcFailure(state.error);
  }
  return captureHandoffStateSchema.parse(state.data);
}

/** GET /api/handoff/state: what the phone may still do. */
export async function handleCaptureHandoffState(request: NextRequest) {
  const unavailable = () =>
    clearGrantCookie(
      answer(409, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" })
    );
  try {
    const ip = await limited(getClientRateLimitIdentity(request).key, "verification:status");
    if (ip) return answer(ip, { error: HANDOFF_MESSAGES.busy });
    const grant = readGrant(request);
    if (!grant) return unavailable();
    const state = await grantState(createFoundationServiceApi(), grant);
    return state ? answer(200, phoneHandoffView(state)) : unavailable();
  } catch (error) {
    return answer(503, {
      error: HANDOFF_MESSAGES.failed,
      reference: logRequestFailure(log, "Phone link state unavailable", {
        request,
        error,
        action: "verification:handoff-state",
      }),
    });
  }
}

/**
 * POST /api/handoff/upload: the phone sends an ID photo or a
 * selfie taken with the camera on the page, for the link's case only. The
 * same camera checks and storage as the signed-in upload.
 */
export async function handleCaptureHandoffUpload(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const apis: unknown[] = [];
  try {
    const ip = await limited(getClientRateLimitIdentity(request).key, "verification:upload");
    if (ip) return answer(ip, { error: "Too many attempts. Please wait a moment." });
    const grant = readGrant(request);
    if (!grant)
      return clearGrantCookie(
        answer(409, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" })
      );
    const service = createFoundationServiceApi();
    apis.push(service);
    const state = await grantState(service, grant);
    if (!state)
      return clearGrantCookie(
        answer(409, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" })
      );
    const own = await limited(state.owner_id, "verification:upload");
    if (own) return answer(own, { error: "Too many attempts. Please wait a moment." });
    const form = await readBoundedRequestFormData(request, 5 * 1024 * 1024 + 16384);
    const allowed = ["file", "docType", "uploadRequestId", "captureMethod", "livenessPassed"];
    if ([...form.keys()].some((key) => !allowed.includes(key) || form.getAll(key).length !== 1))
      return answer(400, { error: "Take the photo again" });
    const requestId = z.uuid().safeParse(form.get("uploadRequestId"));
    const kind = z.enum(["id_document", "selfie"]).safeParse(form.get("docType"));
    const file = form.get("file");
    if (!requestId.success || !kind.success || !(file instanceof File))
      return answer(400, { error: "Take the photo again" });
    const selfie = kind.data === "selfie",
      purpose = selfie ? "selfie" : "id_front";
    const capture = selfie
      ? readSelfieCaptureReport(form.get("captureMethod"), form.get("livenessPassed"))
      : null;
    if (capture === "invalid") return answer(400, { error: "Retake your selfie and try again" });
    if (!selfie && form.has("livenessPassed"))
      return answer(400, { error: "Take the photo again" });
    await assertCameraPhoto(file, form.get("captureMethod"), purpose);
    const bytes = await cleanEvidence(file, selfie);
    const digest = createHmac("sha256", verificationSecret("HMAC_SECRET"))
      .update("handoff-upload-v1\0")
      .update(sha256Hex(grant))
      .update(JSON.stringify([purpose, file.type]))
      .update(Buffer.from(await file.arrayBuffer()))
      .digest("hex");
    const reserved = await service.rpc("reserve_handoff_verification_upload", {
      p_grant_sha256: sha256Hex(grant),
      p_request: requestId.data,
      p_purpose: purpose,
      p_digest: digest,
      ...(selfie ? { p_browser_liveness_passed: capture?.browserLivenessPassed ?? false } : {}),
    });
    if (reserved.error) {
      if (hasDatabaseReason(reserved.error, "handoff_unavailable"))
        return clearGrantCookie(
          answer(409, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" })
        );
      rpcFailure(reserved.error);
    }
    const artifact = z
      .object({
        artifact_id: z.uuid(),
        completed: z.boolean(),
        identity: identityReceiptSchema.nullable(),
      })
      .parse(reserved.data);
    const stored = await storeReservedVerificationUpload({
      service,
      ownerId: state.owner_id,
      requestId: requestId.data,
      purpose,
      artifactId: artifact.artifact_id,
      bytes,
      identity: artifact.identity ?? undefined,
    });
    if (!stored) return answer(403, { error: IDENTITY_BLOCKED_MESSAGE });
    const next = await grantState(service, grant);
    return answer(200, {
      success: true,
      stepType: selfie ? "selfie" : "id_doc",
      ...(next ? phoneHandoffView(next) : { needsId: false, needsSelfie: false }),
    });
  } catch (error) {
    if (error instanceof CameraRequiredError)
      return answer(409, { error: error.message, code: "camera_required" });
    if (error instanceof RequestBodyTooLargeError)
      return answer(413, { error: "Choose a file smaller than 5 MB" });
    if (error instanceof FoundationVerificationError)
      return answer(error.status, { error: error.message });
    return answer(503, {
      error: "The upload could not be confirmed. Please try again.",
      reference: logRequestFailure(log, "Phone upload could not be confirmed", {
        request,
        error,
        api: apis,
        action: "verification:handoff-upload",
      }),
    });
  }
}
