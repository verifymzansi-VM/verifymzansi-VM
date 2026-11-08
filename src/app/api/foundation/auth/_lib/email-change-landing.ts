import "server-only";

import { NextResponse } from "next/server";
import { resolveAppOrigin } from "@/lib/utils/auth-redirect";
import { foundationAuthPrivateResponse } from "./attempt-route";

/** The callback selector for email change links (email-change.ts). */
export const EMAIL_CHANGE_LANDING_PARAM = "email_change";
/** Where a member lands after opening either link: the profile's Account tab,
 * which shows the sign-in address Auth currently holds. */
const EMAIL_CHANGE_LANDING_PATH = "/dashboard/profile#account";
const FAILED_PATH = "/login?error=auth_callback_failed";

/**
 * `/auth/callback?backend=foundation&email_change=1`, where Auth sends a member
 * after an email change link was opened. Auth has already done all the work by
 * then: the first of the two links (current or new address) returns with a
 * `message` that the other one is still needed, the second with a `code`, and
 * a used or expired link with an `error`.
 *
 * This only chooses the page to show. It reads no cookies, exchanges nothing
 * (the code belongs to a PKCE challenge whose verifier was never kept, so it
 * cannot become a session), writes no cookies (no session, no recovery
 * binding) and contacts nobody. Recovery, Google and sign-up confirmations
 * never come here: any such selector, or more than one email change selector,
 * is a failed link.
 */
export function handleFoundationEmailChangeLanding(incoming: Request) {
  const query = new URL(incoming.url).searchParams;
  const single = (name: string) => query.getAll(name).length === 1;
  const accepted =
    process.env.FOUNDATION_PASSWORD_AUTH_MODE === "native-captcha" &&
    process.env.FOUNDATION_AUTH_CALLBACK_ENABLED === "true" &&
    single("backend") &&
    query.get("backend") === "foundation" &&
    single(EMAIL_CHANGE_LANDING_PARAM) &&
    query.get(EMAIL_CHANGE_LANDING_PARAM) === "1" &&
    !["recovery", "oauth", "sb_flow_id", "token_hash", "error", "error_code"].some((name) =>
      query.has(name)
    ) &&
    // One of Auth's two outcomes, never both.
    (single("code") ? !query.has("message") : !query.has("code") && single("message"));
  const response = foundationAuthPrivateResponse(
    NextResponse.redirect(
      new URL(accepted ? EMAIL_CHANGE_LANDING_PATH : FAILED_PATH, resolveAppOrigin(incoming)),
      303
    )
  );
  // The code stays out of any page's Referer.
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
