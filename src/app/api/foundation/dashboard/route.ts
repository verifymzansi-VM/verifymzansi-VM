import type { NextRequest } from "next/server";
import {
  readFoundationAccountContext,
  FoundationAccountContextError,
} from "@/lib/foundation/account-context";
import { readFoundationOwnerDashboard } from "@/lib/foundation/owner-dashboard";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { createLogger } from "@/lib/utils/logger";
const log = createLogger("OwnerDashboard");
export function GET(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "inbox:read",
    mutate: false,
    unavailableMessage: "Your dashboard is temporarily unavailable",
    signInMessage: "Sign in to view your dashboard",
    command: async (api) => {
      const account = await readFoundationAccountContext(api);
      return readFoundationOwnerDashboard(api, account.account_id);
    },
    refusal: (error) =>
      error instanceof FoundationAccountContextError && error.reason === "forbidden"
        ? {
            status: 403,
            error: "Account access is unavailable",
            reason: "account_access_unavailable",
          }
        : null,
  });
}
