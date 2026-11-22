import type { NextRequest } from "next/server";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  extendFreeCredit,
  freeCreditRefusal,
  freeCreditRequest,
  giveFreeCredit,
} from "@/lib/foundation/free-credits";

const log = createLogger("FreeCredits");

/**
 * POST /api/admin/free-credits
 *
 * Give an ID-verified member free posts (1 to 6 posts for 1 to 30 days, with
 * a reason), or extend a gift by 1 to 30 days. Same-origin, CSRF and a
 * per-client rate limit (handleFoundationOwnerRoute); the database checks the
 * caller holds free_credit:give (admins) with an authenticator code from the
 * last 15 minutes, the member and the bounds, and records every gift and
 * extension.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:free-credits",
    mutate: true,
    signInMessage: "Sign in to give free credits",
    unavailableMessage:
      "The free credit could not be confirmed. Reload the page before trying again.",
    refusal: freeCreditRefusal,
    command: async (api, input) => {
      const parsed = freeCreditRequest.parse(input);
      return parsed.action === "give" ? giveFreeCredit(api, parsed) : extendFreeCredit(api, parsed);
    },
  });
}
