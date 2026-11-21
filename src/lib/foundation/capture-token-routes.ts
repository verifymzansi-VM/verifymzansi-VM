import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { FoundationSessionError } from "./request-api";
import { issueCaptureToken, sessionChannel } from "./capture-token";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "../utils/rate-limit";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../utils/request-body";
import { createLogger } from "../utils/logger";
import { logRequestFailure } from "../utils/request-failure";
import { foundationNoStore } from "@/lib/foundation/owner-route";

const log = createLogger("CaptureToken");
const body = z.strictObject({ kind: z.enum(["id_front", "selfie"]) });
export const CAPTURE_TOKEN_UNAVAILABLE = "We couldn't prepare the camera. Please try again.";
export const tokenAnswer = (status: number, payload: Record<string, unknown>) =>
  NextResponse.json(payload, { status, headers: foundationNoStore });

export async function readKind(request: NextRequest) {
  try {
    const parsed = body.safeParse(JSON.parse(await readBoundedRequestText(request, 256)));
    return parsed.success ? parsed.data.kind : null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    return null;
  }
}

export async function refusedByLimit(key: string) {
  const result = await checkRateLimit({
    key,
    action: "verification:capture-token",
    degradedMode: "block",
  });
  return result.degraded || result.limited ? (result.degraded ? 503 : 429) : null;
}

export function failure(request: NextRequest, error: unknown, action: string) {
  if (error instanceof RequestBodyTooLargeError)
    return tokenAnswer(413, { error: CAPTURE_TOKEN_UNAVAILABLE });
  return tokenAnswer(503, {
    error: CAPTURE_TOKEN_UNAVAILABLE,
    reference: logRequestFailure(log, "Capture token unavailable", { request, error, action }),
  });
}

/**
 * POST /api/verification/capture-token: the signed-in page asks for a capture
 * token when its camera starts ({ kind: "id_front" | "selfie" }). The photo
 * must reach the server within 10 minutes of it, from the same sign-in session.
 */
export async function handleMemberCaptureToken(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch (error) {
    return failure(request, error, "verification:capture-token");
  }
  try {
    const ip = await refusedByLimit(getClientRateLimitIdentity(request).key);
    if (ip) return context.respond(tokenAnswer(ip, { error: CAPTURE_TOKEN_UNAVAILABLE }));
    const caller = await context.authenticateCaller();
    const kind = await readKind(request);
    if (!kind) return context.respond(tokenAnswer(400, { error: CAPTURE_TOKEN_UNAVAILABLE }));
    return context.respond(
      tokenAnswer(200, {
        token: issueCaptureToken({
          accountId: caller.accountId,
          kind,
          channel: sessionChannel(caller.sessionId),
        }),
      })
    );
  } catch (error) {
    if (error instanceof FoundationSessionError)
      return context.respond(
        tokenAnswer(error.status, {
          error:
            error.status === 401 ? "Sign in to continue verification" : CAPTURE_TOKEN_UNAVAILABLE,
        })
      );
    return failure(request, error, "verification:capture-token");
  }
}
