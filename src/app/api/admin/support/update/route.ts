import { NextRequest } from "next/server";
import { z } from "zod";
import { adminSupportUpdateSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("AdminSupportUpdate");

/**
 * POST /api/admin/support/update
 *
 * Sets a support request's status (new, in_progress or resolved; any
 * transition is allowed) against the revision the staff member last saw.
 */
export async function POST(req: Request) {
  return handleFoundationOwnerRoute({
    request: req instanceof NextRequest ? req : new NextRequest(req),
    log,
    action: "admin:support:update",
    mutate: true,
    signInMessage: "Sign in to update support requests",
    unavailableMessage: "The status could not be confirmed. Reload the support inbox.",
    refusal: staffCommandRefusal,
    command: async (api, body) => {
      const input = adminSupportUpdateSchema
        .extend({ revision: z.number().int().min(1).max(2147483646) })
        .strict()
        .parse(body);
      await settleStaffCommand(
        api.rpc(
          "update_frontend_support_status",
          { p_ticket: input.submissionId, p_revision: input.revision, p_status: input.status },
          { get: false }
        ),
        z.strictObject({
          id: z.literal(input.submissionId),
          status: z.literal(input.status),
          revision: z
            .number()
            .int()
            .min(input.revision)
            .max(input.revision + 1),
        })
      );
      return { status: "ok" };
    },
  });
}
