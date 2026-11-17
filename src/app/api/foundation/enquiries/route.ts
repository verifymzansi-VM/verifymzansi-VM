import { NextResponse, type NextRequest } from "next/server";
import { readFoundationEnquiries, setFoundationEnquiryStatus } from "@/lib/foundation/owner-inbox";
import { submitPublicEnquiry } from "@/lib/foundation/public-enquiry";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { createLogger } from "@/lib/utils/logger";
import { parseJsonRequest } from "@/lib/utils/api";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { inboxPageQuery, inboxRefusal } from "@/lib/foundation/inbox-refusal";

const log = createLogger("FoundationEnquiries");

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
class FoundationNotFound extends Error {
  override name = "FoundationNotFound";
}

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
  return submitPublicEnquiry({ request, log, turnstileToken: token, enquiry });
}
