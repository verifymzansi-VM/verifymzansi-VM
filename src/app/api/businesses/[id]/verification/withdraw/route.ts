import { type NextRequest } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("BusinessVerificationWithdraw");

const bodySchema = z.object({ caseId: z.string().uuid() });

/** POST /api/businesses/[id]/verification/withdraw — the owner cancels an open case. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "business-verification:withdraw",
    mutate: true,
    unavailableMessage: "The withdrawal could not be confirmed. Reload the business check.",
    signInMessage: "Sign in to withdraw this check",
    refusal: staffCommandRefusal,
    command: async (api, body) =>
      settleStaffCommand(
        api.rpc(
          "withdraw_frontend_business_check",
          {
            p_business: z.uuid().parse((await params).id),
            p_case: bodySchema.strict().parse(body).caseId,
          },
          { get: false }
        ),
        z.strictObject({ ok: z.literal(true) })
      ),
  });
}
