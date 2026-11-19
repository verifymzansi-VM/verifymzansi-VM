import { type NextRequest, NextResponse } from "next/server";
import { SHOW_ACCOUNT_DELETION } from "@/lib/hidden-features";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { accountClosureRefusal, closeMyAccount } from "@/lib/foundation/account-closure";

const log = createLogger("AccountDelete");

/**
 * POST /api/account/delete
 *
 * "Delete account" on the profile's Account tab: closes the signed-in
 * member's own account (api.close_my_account) once they typed DELETE. Same
 * origin and CSRF, the account:delete limit per client and per account, a
 * GoTrue-verified session that signed in with a password or Google in the
 * last 15 minutes; the database refuses a staff account, and the account
 * always comes from the session.
 */
export async function POST(request: NextRequest) {
  // Hidden until it works (src/lib/hidden-features.ts): answers 404.
  if (!SHOW_ACCOUNT_DELETION) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "account:delete",
    mutate: true,
    requireCaller: true,
    maxBytes: 1024,
    // Also the answer to a retry after a closure: its sessions are gone.
    signInMessage:
      "You are signed out. If you just deleted your account, it is closed; otherwise sign in again to delete it.",
    // Only failures before the closure is sent reach this message.
    unavailableMessage:
      "Your account could not be closed right now. Nothing was changed; try again in a few minutes.",
    refusal: accountClosureRefusal,
    command: (api, body, caller) => closeMyAccount(api, body, caller),
  });
}
