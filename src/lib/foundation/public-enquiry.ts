import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import {
  buildFoundationEnquiry,
  FoundationInboxError,
  submitFoundationEnquiry,
} from "@/lib/foundation/owner-inbox";
import { inboxRefusal } from "@/lib/foundation/inbox-refusal";
import { searchFoundationPresentedCards } from "@/lib/foundation/public-cards";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import { foundationNoStore, type FoundationRefusal } from "@/lib/foundation/owner-route";
import { verifyPublicTurnstile } from "@/lib/utils/public-mutation-route";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import type { Logger } from "@/lib/utils/logger";

type EnquiryCommand = ReturnType<typeof buildFoundationEnquiry>;

const unavailable = () =>
  NextResponse.json(
    { error: "Messages are temporarily unavailable" },
    { status: 503, headers: foundationNoStore }
  );

/**
 * A business owner can turn the enquiry form off (the form's contact methods,
 * stored with the business's public presentation). The restored page then
 * hides "Send an enquiry", and the old route refused such enquiries; the
 * database accepts enquiries for every live business, so the website checks it
 * here. Only the public card read is used; a failed read refuses (503), never
 * passes. Posts that are not public businesses are left to the database.
 */
async function businessTurnedOffEnquiries(postId: string) {
  let cards: Awaited<ReturnType<typeof searchFoundationPresentedCards>>;
  try {
    cards = await searchFoundationPresentedCards(foundationServerPublicApi(), {
      post_id: postId,
      offset: 0,
      limit: 1,
    });
  } catch {
    throw new FoundationInboxError("unavailable");
  }
  const card = cards.items[0];
  if (!card || card.kind !== "business") return false;
  const details = card.presentation.frontend?.data.category_details;
  const methods =
    details && typeof details === "object"
      ? (details as { contact_methods?: unknown }).contact_methods
      : undefined;
  return (
    Array.isArray(methods) && !methods.some((method) => method === "form" || method === "in_app")
  );
}

// Placeholder that only satisfies the input schema; it is replaced before the
// command is sent.
const PENDING_REQUEST_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Request id for a form that sends none (the restored enquiry dialog): a
 * SHA-256 of exactly the fields submit_enquiry compares on replay, plus the UTC
 * day. Sending the same enquiry twice on one day (a double tap, a retry after a
 * lost reply) stores it once and emails the owner once; the same words on a
 * later day are a new enquiry. Shaped as an RFC 9562 version 8 UUID.
 */
export async function derivedEnquiryRequestId(command: EnquiryCommand, now = new Date()) {
  const material = JSON.stringify([
    "verifymzansi-enquiry-v1",
    now.toISOString().slice(0, 10),
    command.p_post_id,
    command.p_sender ?? null,
    command.p_buyer_name ?? null,
    command.p_buyer_email,
    command.p_buyer_phone ?? null,
    command.p_message,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Public enquiry on a live post, signed in or not, through the trusted
 * api.submit_enquiry command. Call it after the route's origin/CSRF check and
 * body parsing. Here: Turnstile, then the GoTrue-verified sender (or none for a
 * signed-out visitor; never taken from the body), then the per-sender or
 * per-client rate limit (blocking when the limiter is degraded), then exactly
 * one command (after checking that a business has not turned enquiries
 * off). SQL rechecks the post, its contact choice, the sender account
 * and flood limits, and derives whether the reply email is confirmed.
 *
 * `enquiry` holds the command fields (request_id, post_id, buyer_name,
 * buyer_email, buyer_phone, message). With `deriveRequestId` the request id is
 * derived from the content instead (see derivedEnquiryRequestId); if another
 * request already holds that id with different details, the enquiry is sent
 * once more under a fresh random id, since nothing of it was stored.
 */
export async function submitPublicEnquiry({
  request,
  log,
  turnstileToken,
  enquiry,
  deriveRequestId = false,
  refusal = inboxRefusal,
}: {
  request: NextRequest;
  log: Logger;
  turnstileToken: string;
  enquiry: Record<string, unknown>;
  deriveRequestId?: boolean;
  refusal?: (error: unknown) => FoundationRefusal | null;
}): Promise<NextResponse> {
  const captcha = await verifyPublicTurnstile(request, turnstileToken, log);
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
    let command = buildFoundationEnquiry(
      deriveRequestId ? { ...enquiry, request_id: PENDING_REQUEST_ID } : enquiry,
      sender
    );
    if (deriveRequestId)
      command = { ...command, p_request_id: await derivedEnquiryRequestId(command) };
    if (await businessTurnedOffEnquiries(command.p_post_id))
      return context.respond(
        NextResponse.json(
          {
            error:
              "This recipient has not enabled enquiries. Please use the contact options on the post.",
            reason: "enquiries_disabled",
          },
          { status: 403 }
        )
      );
    const service = createFoundationServiceApi();
    try {
      await submitFoundationEnquiry(service, command);
    } catch (error) {
      if (
        !deriveRequestId ||
        !(error instanceof FoundationInboxError) ||
        error.reason !== "conflict"
      )
        throw error;
      await submitFoundationEnquiry(service, { ...command, p_request_id: crypto.randomUUID() });
    }
    return context.respond(NextResponse.json({ success: true }));
  } catch (error) {
    const known = refusal(error);
    if (known)
      return context.respond(
        NextResponse.json({ error: known.error, reason: known.reason }, { status: known.status })
      );
    log.error("Foundation enquiry failed");
    return context.respond(unavailable());
  }
}
