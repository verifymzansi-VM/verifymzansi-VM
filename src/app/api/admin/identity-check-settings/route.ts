import type { NextRequest } from "next/server";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  identityCheckModeRequest,
  identityCheckSettingRefusal,
  setIdentityCheckMode,
} from "@/lib/foundation/identity-check-staff";

const log = createLogger("IdentityCheckSettings");

/**
 * POST /api/admin/identity-check-settings
 *
 * Sets where members' ID checks go (manual, staff_final or automatic) with a
 * reason; setting the current mode again ends a pause. Same-origin, CSRF and
 * a per-client rate limit (handleFoundationOwnerRoute); the database checks
 * the caller holds identity_check:configure (admins) with an authenticator
 * code from the last 15 minutes, and logs every change.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:identity-check-settings",
    mutate: true,
    signInMessage: "Sign in to change the ID check setting",
    unavailableMessage:
      "The ID check setting could not be confirmed. Reload the page before trying again.",
    refusal: identityCheckSettingRefusal,
    command: async (api, input) => setIdentityCheckMode(api, identityCheckModeRequest.parse(input)),
  });
}
