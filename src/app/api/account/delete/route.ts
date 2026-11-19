import { type NextRequest, NextResponse } from "next/server";
import { SHOW_ACCOUNT_DELETION } from "@/lib/hidden-features";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { accountClosureRefusal, closeMyAccount } from "@/lib/foundation/account-closure";
import { ACCOUNT_CLOSURE_SIGNED_OUT } from "@/lib/account/account-closure";

const log = createLogger("AccountDelete");

/** Auth's session cookie and its chunks (sb-<project>-auth-token[.N]). */
const AUTH_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?$/;

/** After a closure every session has ended: drop this browser's copy too. */
function expireAuthCookies(request: NextRequest, response: NextResponse) {
  const names = new Set(
    [...request.cookies.getAll(), ...response.cookies.getAll()].map((item) => item.name)
  );
  for (const name of names)
    if (AUTH_COOKIE.test(name))
      response.cookies.set(name, "", {
        path: "/",
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: 0,
      });
  return response;
}

/**
 * POST /api/account/delete
 *
 * "Delete account" on the profile's Account tab: closes the signed-in
 * member's own account (api.close_my_account) once they typed DELETE. Same
 * origin and CSRF, the account:delete limit per client and per account, a
 * GoTrue-verified session that signed in with a password or Google in the
 * last 15 minutes; the database refuses a staff account, and the account
 * always comes from the session. A closure also expires the session cookies.
 */
export async function POST(request: NextRequest) {
  // Hidden until it works (src/lib/hidden-features.ts): answers 404.
  if (!SHOW_ACCOUNT_DELETION) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const response = await handleFoundationOwnerRoute({
    request,
    log,
    action: "account:delete",
    mutate: true,
    requireCaller: true,
    maxBytes: 1024,
    // Also the answer to a retry after a closure: its sessions are gone.
    signInMessage: ACCOUNT_CLOSURE_SIGNED_OUT,
    // Only failures before the closure is sent reach this message.
    unavailableMessage:
      "Your account could not be closed right now. Nothing was changed; try again in a few minutes.",
    refusal: accountClosureRefusal,
    command: (api, body, caller) => closeMyAccount(api, body, caller),
  });
  return response.status === 200 ? expireAuthCookies(request, response) : response;
}
