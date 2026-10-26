import type { NextRequest } from "next/server";
import { acknowledgeFoundationCostAlarm, FoundationCostError } from "@/lib/foundation/staff-costs";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "../../_lib/owner-route";
const log = createLogger("FoundationStaffCosts");
export function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:governance:decide",
    mutate: true,
    includeAccountId: true,
    unavailableMessage: "The cost alarm could not be acknowledged",
    signInMessage: "Sign in to continue",
    command: acknowledgeFoundationCostAlarm,
    refusal(error) {
      if (!(error instanceof FoundationCostError)) return null;
      return {
        status: error.status,
        reason: error.status === 403 ? "forbidden" : "unavailable",
        error:
          error.status === 403
            ? "Current staff permission and two-step verification are required"
            : error.status === 409
              ? "This alarm has changed; refresh the page"
              : error.status === 400
                ? "Choose a valid cost alarm"
                : "The cost alarm could not be acknowledged",
      };
    },
  });
}
