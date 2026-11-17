import { type NextRequest } from "next/server";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { accountClosureRefusal, closeMyAccount } from "@/lib/foundation/account-closure";

const log = createLogger("AccountDelete");

/**
 * POST /api/account/delete
 *
 * "Delete account" on the profile's Account tab: closes the signed-in
 * member's own account (api.close_my_account) once they typed DELETE. Same
 * origin and CSRF, a per-client limit (account:delete), a GoTrue-verified
 * session; the database checks that this session signed in within the last
 * 15 minutes and is not a staff account, and the account always comes from
 * the session.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "account:delete",
    mutate: true,
    maxBytes: 1024,
    signInMessage: "Sign in again to delete your account.",
    unavailableMessage:
      "Your account could not be closed right now. Reload the page to check before trying again.",
    refusal: accountClosureRefusal,
    command: (api, body) => closeMyAccount(api, body),
  });
}
