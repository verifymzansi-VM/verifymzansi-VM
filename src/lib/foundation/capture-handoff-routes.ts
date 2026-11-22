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
import { readSelfieCaptureReport } from "./selfie-capture";
import {
  assertCameraPhoto,
  assertCaptureToken,
  CameraRequiredError,
  IDENTITY_BLOCKED_MESSAGE,
  identityReceiptSchema,
  readIdentityDetails,
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
import {
  readBoundedRequestFormData,
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "../utils/request-body";
import { createLogger } from "../utils/logger";
import { logRequestFailure } from "../utils/request-failure";
import { foundationNoStore } from "@/lib/foundation/owner-route";
import { hasDatabaseReason } from "./error-reasons";
import { grantChannel, issueCaptureToken } from "./capture-token";
import { refuseWhileAutomaticCheckOpen } from "./identity-check";
import {
  CAPTURE_TOKEN_UNAVAILABLE,
  failure as tokenFailure,
  readKind,
  refusedByLimit,
  tokenAnswer,
} from "./capture-token-routes";

const log = createLogger("CaptureHandoff");

/** A small JSON body (the start and open requests are a few hundred bytes). */
async function readSmallJson(request: NextRequest): Promise<unknown> {
  try {
    return JSON.parse(await readBoundedRequestText(request, 4096));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    return null;
  }
}

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
  signIn: "Sign in on your phone with the same account, then take the photos.",
  sessionCheck: "We couldn't check your sign-in right now. Please try again.",
  inactive: "Confirm your email address and make sure your account is active, then try again.",
  done: "Your phone has sent both photos. Go back to your computer.",
  retake: "Your photo wasn't sent. Please take it again.",
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
export async function handleStartCaptureHandoff(request: NextRequest): Promise<NextResponse> {
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
    await refuseWhileAutomaticCheckOpen(caller.api);
    const raw = await readSmallJson(request);
    const body = startBody.safeParse(raw);
    if (!body.success) return reply(400, { error: HANDOFF_MESSAGES.needsId });
    const details =
      "idNumber" in body.data
        ? readIdentityDetails(
            caller.accountId,
            body.data.idNumber,
            body.data.firstName,
            body.data.lastName
          )
        : null;
    if (details && "error" in details) return reply(400, { error: details.error });
    const token = newHandoffSecret();
    const started = await caller.api.rpc("start_capture_handoff", {
      p_token_sha256: sha256Hex(token),
      ...(details
        ? { p_first_name: details.firstName, p_last_name: details.lastName, p_with_id: true }
        : {}),
    });
    if (started.error) {
      const error = started.error as HandoffError;
      if (error.code === "PT429") return reply(429, { error: HANDOFF_MESSAGES.rateLimited });
      if (hasDatabaseReason(error, "handoff_needs_id"))
        return reply(409, { error: HANDOFF_MESSAGES.needsId, code: "handoff_needs_id" });
      // No live, confirmed, active account behind this session.
      if (error.code === "42501") return reply(403, { error: HANDOFF_MESSAGES.inactive });
      rpcFailure(error);
    }
    const made = z
      .object({ expires_at: z.string().min(1), needs_id: z.boolean() })
      .parse(started.data);
    // The ID number receipt is made here, from the checked ID number, and
    // attached by the server only: a member can never supply one.
    if (details) {
      const attached = await createFoundationServiceApi().rpc("attach_capture_handoff_identity", {
        p_owner: caller.accountId,
        p_token_sha256: sha256Hex(token),
        p_identity: details.identity,
      });
      if (attached.error) rpcFailure(attached.error);
    }
    // The site's configured address, else this request's own origin (already
    // checked as same-origin above); never a guessed address.
    const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    return reply(200, {
      qr: handoffQrCode(handoffLink(origin, token)),
      expiresAt: made.expires_at,
      needsId: made.needs_id,
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return reply(413, { error: HANDOFF_MESSAGES.failed });
    if (error instanceof FoundationSessionError)
      return reply(error.status, {
        error:
          error.status === 401 ? "Sign in to continue verification" : HANDOFF_MESSAGES.sessionCheck,
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

/**
 * The capture grant cookie. Over HTTPS it is a __Secure- cookie (the browser
 * refuses it without Secure); only a plain-HTTP local test copy uses the
 * unprefixed name without Secure.
 */
function grantCookie(request: NextRequest) {
  const secure = request.nextUrl.protocol === "https:";
  return { name: secure ? `__Secure-${CAPTURE_GRANT_COOKIE}` : CAPTURE_GRANT_COOKIE, secure };
}
function setGrantCookie(
  request: NextRequest,
  response: NextResponse,
  value: string,
  expiresAt?: string
) {
  const { name, secure } = grantCookie(request);
  const seconds = expiresAt ? Math.floor((Date.parse(expiresAt) - Date.now()) / 1000) : 0;
  response.cookies.set(name, value, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: CAPTURE_GRANT_COOKIE_PATH,
    maxAge: expiresAt ? Math.max(1, Math.min(900, seconds)) : 0,
  });
  return response;
}
function readGrant(request: NextRequest) {
  const parsed = handoffSecretSchema.safeParse(
    request.cookies.get(grantCookie(request).name)?.value
  );
  return parsed.success ? parsed.data : null;
}

/** The phone must be signed in as the account that made the link (owner
 * decision): its GoTrue-verified account, or a ready answer to send. */
async function phoneCaller(request: NextRequest, action: string) {
  const context = connection(request, action);
  if (!context)
    return { ok: false, refusal: answer(503, { error: HANDOFF_MESSAGES.failed }) } as const;
  try {
    const caller = await context.authenticateCaller();
    return { ok: true, context, caller } as const;
  } catch (error) {
    if (!(error instanceof FoundationSessionError)) throw error;
    return {
      ok: false,
      refusal: await context.respond(
        error.status === 401
          ? NextResponse.json<Record<string, unknown>>(
              { error: HANDOFF_MESSAGES.signIn, code: "handoff_sign_in_required" },
              { status: 401 }
            )
          : NextResponse.json<Record<string, unknown>>(
              { error: HANDOFF_MESSAGES.sessionCheck },
              { status: 503 }
            )
      ),
    } as const;
  }
}

/** A refused phone-link command. Only a link the database says is gone
 * (handoff_unavailable) clears the phone's capture grant. */
type Refusal = { status: number; body: Record<string, unknown>; linkGone?: boolean };
type GrantState =
  | { ok: false; refusal: Refusal }
  | { ok: true; state: ReturnType<typeof captureHandoffStateSchema.parse> };

/**
 * The answer for a refused phone-link command, or null to rethrow. Other
 * refusals without a known reason are answered as `otherwise`: opening a link
 * and reading its state say the link can't be used; a photo is taken again,
 * with the grant kept (the photo order, a changed request, a returned
 * submission).
 */
function phoneRefusal(
  error: HandoffError,
  otherwise: "unavailable" | "retake" = "unavailable"
): Refusal | null {
  if (hasDatabaseReason(error, "handoff_sign_in_required"))
    return {
      status: 401,
      body: { error: HANDOFF_MESSAGES.signIn, code: "handoff_sign_in_required" },
    };
  if (hasDatabaseReason(error, "handoff_other_account"))
    return {
      status: 403,
      body: { error: HANDOFF_MESSAGES.otherAccount, code: "handoff_other_account" },
    };
  if (hasDatabaseReason(error, "handoff_done"))
    return { status: 409, body: { error: HANDOFF_MESSAGES.done, code: "handoff_done" } };
  if (hasDatabaseReason(error, "handoff_unavailable"))
    return {
      status: 409,
      body: { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" },
      linkGone: true,
    };
  if (error.code !== "PT409" && error.code !== "22023") return null;
  return otherwise === "retake"
    ? { status: 409, body: { error: HANDOFF_MESSAGES.retake, code: "handoff_retake" } }
    : {
        status: 409,
        body: { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" },
      };
}

/**
 * POST /api/handoff/open: the phone, signed in as the link's owner, opens the
 * link (the token from the #fragment, in the body). Single use. Sets the
 * capture grant cookie.
 */
export async function handleOpenCaptureHandoff(request: NextRequest): Promise<NextResponse> {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  try {
    const ip = await limited(getClientRateLimitIdentity(request).key, "verification:handoff-open");
    if (ip) return answer(ip, { error: HANDOFF_MESSAGES.busy });
    const body = z
      .strictObject({ token: handoffSecretSchema })
      .safeParse(await readSmallJson(request));
    if (!body.success)
      return answer(409, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" });
    const phone = await phoneCaller(request, "verification:handoff-open");
    if (!phone.ok) return phone.refusal;
    const { context, caller } = phone;
    const grant = newHandoffSecret();
    const opened = await createFoundationServiceApi().rpc("redeem_capture_handoff", {
      p_token_sha256: sha256Hex(body.data.token),
      p_grant_sha256: sha256Hex(grant),
      p_signed_in: caller.accountId,
    });
    if (opened.error) {
      const refusal = phoneRefusal(opened.error as HandoffError);
      if (!refusal) return rpcFailure(opened.error);
      return context.respond(NextResponse.json(refusal.body, { status: refusal.status }));
    }
    const state = captureHandoffStateSchema.parse(opened.data);
    const response = await context.respond(NextResponse.json(phoneHandoffView(state)));
    return setGrantCookie(request, response, grant, state.expires_at);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return answer(413, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" });
    return answer(503, {
      error: HANDOFF_MESSAGES.failed,
      reference: logRequestFailure(log, "Phone link could not be opened", {
        request,
        error,
        action: "verification:handoff-open",
      }),
    });
  }
}

/** The link's state for the signed-in phone, or the refusal to answer. */
async function grantState(
  service: FoundationServiceApi,
  grant: string,
  signedIn: string
): Promise<GrantState> {
  const state = await service.rpc("capture_handoff_context", {
    p_grant_sha256: sha256Hex(grant),
    p_signed_in: signedIn,
  });
  if (state.error) {
    const refusal = phoneRefusal(state.error as HandoffError);
    if (!refusal) return rpcFailure(state.error);
    return { ok: false, refusal };
  }
  return { ok: true, state: captureHandoffStateSchema.parse(state.data) };
}

/** A refusal, with the grant cookie cleared only when the link is gone. */
async function refuse(
  request: NextRequest,
  context: { respond: (r: NextResponse) => Promise<NextResponse> },
  refusal: Refusal
) {
  const response = await context.respond(
    NextResponse.json(refusal.body, { status: refusal.status })
  );
  return refusal.linkGone ? setGrantCookie(request, response, "") : response;
}

/** GET /api/handoff/state: what the signed-in phone may still do. */
export async function handleCaptureHandoffState(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = await limited(getClientRateLimitIdentity(request).key, "verification:status");
    if (ip) return answer(ip, { error: HANDOFF_MESSAGES.busy });
    const grant = readGrant(request);
    if (!grant)
      return answer(409, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" });
    const phone = await phoneCaller(request, "verification:handoff-state");
    if (!phone.ok) return phone.refusal;
    const found = await grantState(createFoundationServiceApi(), grant, phone.caller.accountId);
    if (!found.ok) return refuse(request, phone.context, found.refusal);
    return phone.context.respond(NextResponse.json(phoneHandoffView(found.state)));
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
 * POST /api/handoff/upload: the signed-in phone sends an ID photo or a selfie
 * taken with the camera on the page, for the link's case only. The same
 * camera checks, capture token and storage as the signed-in upload.
 */
export async function handleCaptureHandoffUpload(request: NextRequest): Promise<NextResponse> {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const apis: unknown[] = [];
  try {
    const ip = await limited(getClientRateLimitIdentity(request).key, "verification:upload");
    if (ip) return answer(ip, { error: "Too many attempts. Please wait a moment." });
    const grant = readGrant(request);
    if (!grant)
      return answer(409, { error: HANDOFF_MESSAGES.unavailable, code: "handoff_unavailable" });
    const phone = await phoneCaller(request, "verification:handoff-upload");
    if (!phone.ok) return phone.refusal;
    const { context, caller } = phone;
    const reply = (status: number, body: Record<string, unknown>) =>
      context.respond(NextResponse.json(body, { status }));
    const service = createFoundationServiceApi();
    apis.push(service);
    const found = await grantState(service, grant, caller.accountId);
    if (!found.ok) return refuse(request, context, found.refusal);
    const own = await limited(caller.accountId, "verification:upload");
    if (own) return reply(own, { error: "Too many attempts. Please wait a moment." });
    await refuseWhileAutomaticCheckOpen(caller.api);
    const form = await readBoundedRequestFormData(request, 5 * 1024 * 1024 + 16384);
    const allowed = [
      "file",
      "docType",
      "uploadRequestId",
      "captureMethod",
      "livenessPassed",
      "captureToken",
    ];
    if ([...form.keys()].some((key) => !allowed.includes(key) || form.getAll(key).length !== 1))
      return reply(400, { error: "Take the photo again" });
    const requestId = z.uuid().safeParse(form.get("uploadRequestId"));
    const kind = z.enum(["id_document", "selfie"]).safeParse(form.get("docType"));
    const file = form.get("file");
    if (!requestId.success || !kind.success || !(file instanceof File))
      return reply(400, { error: "Take the photo again" });
    const selfie = kind.data === "selfie",
      purpose = selfie ? "selfie" : "id_front";
    const capture = selfie
      ? readSelfieCaptureReport(form.get("captureMethod"), form.get("livenessPassed"))
      : null;
    if (capture === "invalid") return reply(400, { error: "Retake your selfie and try again" });
    if (!selfie && form.has("livenessPassed")) return reply(400, { error: "Take the photo again" });
    await assertCameraPhoto(file, form.get("captureMethod"), purpose);
    assertCaptureToken(form.get("captureToken"), {
      accountId: caller.accountId,
      kind: purpose,
      channel: grantChannel(sha256Hex(grant)),
    });
    const bytes = await cleanEvidence(file, selfie);
    const digest = createHmac("sha256", verificationSecret("HMAC_SECRET"))
      .update("handoff-upload-v1\0")
      .update(sha256Hex(grant))
      .update(JSON.stringify([purpose, file.type]))
      .update(Buffer.from(await file.arrayBuffer()))
      .digest("hex");
    const reserved = await service.rpc("reserve_handoff_verification_upload", {
      p_grant_sha256: sha256Hex(grant),
      p_signed_in: caller.accountId,
      p_request: requestId.data,
      p_purpose: purpose,
      p_digest: digest,
      ...(selfie ? { p_browser_liveness_passed: capture?.browserLivenessPassed ?? false } : {}),
    });
    if (reserved.error) {
      const refusal = phoneRefusal(reserved.error as HandoffError, "retake");
      if (refusal) return refuse(request, context, refusal);
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
      ownerId: caller.accountId,
      requestId: requestId.data,
      purpose,
      artifactId: artifact.artifact_id,
      bytes,
      identity: artifact.identity ?? undefined,
    });
    if (!stored) return reply(403, { error: IDENTITY_BLOCKED_MESSAGE });
    const next = await grantState(service, grant, caller.accountId);
    return reply(200, {
      success: true,
      stepType: selfie ? "selfie" : "id_doc",
      ...(next.ok ? phoneHandoffView(next.state) : { needsId: false, needsSelfie: false }),
    });
  } catch (error) {
    if (error instanceof CameraRequiredError)
      return answer(409, { error: error.message, code: error.code });
    if (error instanceof RequestBodyTooLargeError)
      return answer(413, { error: "This photo is too large. Please take it again." });
    if (error instanceof FoundationVerificationError)
      return answer(error.status, { error: error.message });
    return answer(503, {
      error: "Your photo couldn't be sent. Please try again.",
      reference: logRequestFailure(log, "Phone photo could not be confirmed", {
        request,
        error,
        api: apis,
        action: "verification:handoff-upload",
      }),
    });
  }
}

/**
 * POST /api/handoff/capture-token: the same for a phone signed in as the
 * link's owner, bound to its capture grant (and so to the link's case).
 */
export async function handlePhoneCaptureToken(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  try {
    const ip = await refusedByLimit(getClientRateLimitIdentity(request).key);
    if (ip) return tokenAnswer(ip, { error: CAPTURE_TOKEN_UNAVAILABLE });
    const grant = readGrant(request);
    if (!grant)
      return tokenAnswer(409, { error: CAPTURE_TOKEN_UNAVAILABLE, code: "handoff_unavailable" });
    const phone = await phoneCaller(request, "verification:handoff-capture-token");
    if (!phone.ok) return phone.refusal;
    const kind = await readKind(request);
    if (!kind) return phone.context.respond(tokenAnswer(400, { error: CAPTURE_TOKEN_UNAVAILABLE }));
    const found = await grantState(createFoundationServiceApi(), grant, phone.caller.accountId);
    if (!found.ok)
      return phone.context.respond(tokenAnswer(found.refusal.status, found.refusal.body));
    return phone.context.respond(
      tokenAnswer(200, {
        token: issueCaptureToken({
          accountId: phone.caller.accountId,
          kind,
          channel: grantChannel(sha256Hex(grant)),
        }),
      })
    );
  } catch (error) {
    return tokenFailure(request, error, "verification:handoff-capture-token");
  }
}
