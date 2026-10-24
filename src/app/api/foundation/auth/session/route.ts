import type { NextRequest } from "next/server";
import {
  readFoundationAccountContext,
  FoundationAccountContextError,
} from "@/lib/foundation/account-context";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "../../_lib/owner-route";

const log = createLogger("FoundationAccountSession");
export function GET(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "profile:read",
    mutate: false,
    unavailableMessage: "Your account details are temporarily unavailable",
    signInMessage: "Sign in to view your account",
    command: (api) => readFoundationAccountContext(api),
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
