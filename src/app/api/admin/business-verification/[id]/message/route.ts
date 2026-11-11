import { NextRequest } from "next/server";
import { z } from "zod";

import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("AdminBusinessVerificationMessage");

const schema = z.object({ body: z.string().trim().min(1).max(2000) });

/**
 * POST /api/admin/business-verification/[id]/message
 * A note to the owner that does not change the case status. To pause the
 * case for the owner, use the "request info" decision instead.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleFoundationOwnerRoute({
    request: request instanceof NextRequest ? request : new NextRequest(request),
    log,
    action: "business-verification:message",
    mutate: true,
    successStatus: 201,
    maxBytes: 13500,
    signInMessage: "Sign in to work on business checks",
    unavailableMessage: "The message could not be confirmed. Reload the check.",
    refusal: staffCommandRefusal,
    command: async (api, input) =>
      settleStaffCommand(
        api.rpc(
          "send_frontend_seen_message",
          {
            p_case: z.uuid().parse((await params).id),
            p_body: schema.strict().parse(input).body,
          },
          { get: false }
        ),
        z.strictObject({ ok: z.literal(true) })
      ),
  });
}
