import { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("GovernanceLiftRestriction");

const nativeLiftSchema = z.strictObject({
  restrictionId: z.uuid(),
  expectedVersion: z.number().int().min(1).max(2147483646),
  reason: z.string().trim().min(10).max(500),
});

/**
 * POST /api/admin/governance/restrictions/lift
 *
 * Lift a warning, suspension or ban outside an appeal. The person lifting it
 * must not have taken part in imposing it. Content the restriction hid is
 * restored only when no other suspension or ban on the account remains.
 */
export async function POST(request: Request) {
  return handleFoundationOwnerRoute({
    request: request instanceof NextRequest ? request : new NextRequest(request),
    log,
    action: "admin:governance:lift",
    mutate: true,
    unavailableMessage: "The lift could not be confirmed. Reload restrictions before trying again.",
    signInMessage: "Sign in to review restrictions",
    refusal: staffCommandRefusal,
    command: async (api, body) => {
      const input = nativeLiftSchema.parse(body);
      const result = await settleStaffCommand(
        api.rpc(
          "lift_frontend_account_restriction",
          {
            p_restriction: input.restrictionId,
            p_expected_version: input.expectedVersion,
            p_reason: input.reason,
          },
          { get: false }
        ),
        z.strictObject({
          restriction_id: z.literal(input.restrictionId),
          status: z.literal("lifted"),
          reused: z.boolean().optional(),
        })
      );
      return { status: result.status };
    },
  });
}
