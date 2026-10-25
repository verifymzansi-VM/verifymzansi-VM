import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import {
  buildFoundationEnquiry,
  readFoundationEnquiries,
  setFoundationEnquiryStatus,
  submitFoundationEnquiry,
} from "@/lib/foundation/owner-inbox";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { verifyPublicTurnstile } from "@/lib/utils/public-mutation-route";
import { createLogger } from "@/lib/utils/logger";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { foundationNoStore, handleFoundationOwnerRoute } from "../_lib/owner-route";
import { inboxPageQuery, inboxRefusal } from "../_lib/inbox-refusal";

const log = createLogger("FoundationEnquiries");
const unavailable = () =>
  NextResponse.json(
    { error: "Messages are temporarily unavailable" },
    { status: 503, headers: foundationNoStore }
  );

/** Owner inbox page: GET /api/foundation/enquiries?limit=&status=&before_created=&before_id= */
export function GET(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "inbox:read",
    mutate: false,
    includeAccountId: true,
    unavailableMessage: "Your messages are temporarily unavailable",
    signInMessage: "Sign in to see your messages",
    command: (api) => readFoundationEnquiries(api, inboxPageQuery(request, true)),
    refusal: inboxRefusal,
  });
}

/** Owner status change: { id, status: read | contacted | closed }. */
export function PATCH(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "inbox:update",
    mutate: true,
    unavailableMessage: "Your messages are temporarily unavailable",
    signInMessage: "Sign in to manage your messages",
    command: async (api, input) => {
      const result = await setFoundationEnquiryStatus(api, input);
      if (!result) throw new FoundationNotFound();
      return result;
    },
    refusal: (error) =>
      error instanceof FoundationNotFound
        ? { status: 404, error: "Message not found", reason: "not_found" }
        : inboxRefusal(error),
  });
}
class FoundationNotFound extends Error {}

/**
 * Public enquiry on a live post, signed in or not. Turnstile, origin/CSRF and
 * rate limits run here; the sender is the GoTrue-verified caller or null and
 * is never taken from the body. SQL rechecks the post, contact choice, sender
 * account and flood limits, and derives whether the reply email is confirmed.
 */
export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const body = await parseJsonRequest(request, { maxBytes: 8192 });
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "Check the details and try again" }, { status: 400 });
  const { turnstile_token: token, ...enquiry } = body as Record<string, unknown>;
  if (typeof token !== "string" || token.length < 1 || token.length > 4096)
    return NextResponse.json({ error: "Complete the CAPTCHA" }, { status: 400 });
  const captcha = await verifyPublicTurnstile(request, token, log);
  if (captcha) return captcha;
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return unavailable();
  }
  try {
    let sender: string | null = null;
    try {
      sender = (await context.authenticateCaller()).accountId;
    } catch (error) {
      // No or expired session: a signed-out visitor. Never guess an identity.
      if (!(error instanceof FoundationSessionError) || error.status === 503)
        return context.respond(unavailable());
    }
    const limit = await checkRateLimit({
      key: sender ?? getClientRateLimitIdentity(request).key,
      action: "contact:send",
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          {
            error: limit.degraded
              ? "Messages are temporarily unavailable"
              : "Too many messages; try again later",
          },
          {
            status: limit.degraded ? 503 : 429,
            headers: { "Retry-After": String(limit.retryAfter ?? 60) },
          }
        )
      );
    const command = buildFoundationEnquiry(enquiry, sender);
    await submitFoundationEnquiry(createFoundationServiceApi(), command);
    return context.respond(NextResponse.json({ success: true }));
  } catch (error) {
    const known = inboxRefusal(error);
    if (known)
      return context.respond(
        NextResponse.json({ error: known.error, reason: known.reason }, { status: known.status })
      );
    log.error("Foundation enquiry failed");
    return context.respond(unavailable());
  }
}
