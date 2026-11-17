import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { FoundationInboxError } from "./owner-inbox";
import { inboxRefusal } from "./inbox-refusal";
import { submitPublicEnquiry } from "./public-enquiry";
import { contactAccountHolderSchema } from "../validations/contact";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { parseJsonRequest } from "../utils/api";
import { createLogger } from "../utils/logger";

const log = createLogger("ContactEnquiry");

/** Public posts share one id space, so an unknown id and a post that is not
 * publicly visible get the same answer; a database or service failure never
 * does (it is a 503). */
function contactRefusal(error: unknown) {
  if (error instanceof FoundationInboxError && error.reason === "post_unavailable")
    return { status: 404, error: "Post not found", reason: error.reason };
  return inboxRefusal(error);
}

/**
 * The restored "Send an enquiry" dialog (POST /api/contact) on the foundation
 * backend. Its fields map to api.submit_enquiry: the listingId, businessId or
 * promotionId is the post id; buyerName, buyerEmail, buyerPhone (normalised to
 * +27) and message pass through the command's own input rules; contactMethod
 * is not stored. The dialog sends no request id, so one is derived from the
 * content (a repeated identical enquiry is stored once). Origin/CSRF here, then
 * Turnstile, the verified sender and the rate limit in submitPublicEnquiry. No
 * old-backend client is used.
 */
export async function postFoundationContactEnquiry(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const body = await parseJsonRequest(request, { maxBytes: 8192 });
  if (body === null) return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  const parsed = contactAccountHolderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { targetId, message, buyerName, buyerEmail, buyerPhone, turnstileToken } = parsed.data;
  if (turnstileToken.length > 4096)
    return NextResponse.json({ error: "Complete the CAPTCHA" }, { status: 400 });
  if (!buyerEmail)
    return NextResponse.json(
      { error: "Provide a reply email so the recipient can respond." },
      { status: 400 }
    );
  return submitPublicEnquiry({
    request,
    log,
    turnstileToken,
    deriveRequestId: true,
    refusal: contactRefusal,
    enquiry: {
      post_id: targetId,
      buyer_email: buyerEmail,
      message,
      ...(buyerName === undefined ? {} : { buyer_name: buyerName }),
      ...(buyerPhone === undefined ? {} : { buyer_phone: buyerPhone }),
    },
  });
}
