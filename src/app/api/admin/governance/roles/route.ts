import { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  FoundationStaffCommandError,
  settleStaffCommand,
  staffCommandRefusal,
} from "@/lib/foundation/staff-command";

const log = createLogger("GovernanceRoles");

const reasonSchema = z.string().trim().min(5).max(500);
const noteSchema = z.string().trim().max(500).optional();

const roleChangeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose"),
    targetEmail: z.string().trim().email().max(254),
    newRole: z.enum(["moderator", "governance_controller", "admin", "member"]),
    reason: reasonSchema,
  }),
  z.object({
    action: z.literal("approve"),
    decisionId: z.string().uuid(),
    payloadVersion: z.number().int().min(1),
    note: noteSchema,
  }),
  z.object({
    action: z.literal("reject"),
    decisionId: z.string().uuid(),
    note: noteSchema,
  }),
]);

/**
 * POST /api/admin/governance/roles
 *
 * Propose, approve or reject a staff role change. Policy is enforced in the
 * database (see 20260927110100_staff_role_changes.sql): promotions need an
 * independent approver, admin demotions apply immediately, a governor may
 * propose removing a moderator, and nobody changes their own role.
 *
 * Every action needs a second factor verified in the last 15 minutes.
 */
export async function POST(request: Request) {
  return handleFoundationOwnerRoute({
    request: request instanceof NextRequest ? request : new NextRequest(request),
    log,
    action: "admin:role:review",
    mutate: true,
    requireCaller: true,
    signInMessage: "Sign in to manage staff roles",
    unavailableMessage: "The role change could not be confirmed. Reload the roster.",
    refusal: staffCommandRefusal,
    command: async (api, input, caller) => {
      if (!caller) throw new Error("Verified role reviewer required");
      const body = roleChangeSchema.parse(input);
      const limit = await checkSensitiveActionRateLimit(caller.accountId, "admin:role:assign", 5);
      if (limit.degraded || limit.limited)
        throw new FoundationStaffCommandError(
          limit.degraded ? 503 : 429,
          "Role changes are temporarily limited. Try again shortly."
        );
      const rpc =
        body.action === "propose"
          ? await api.rpc(
              "propose_frontend_staff_role",
              {
                p_email: body.targetEmail,
                p_role: body.newRole === "governance_controller" ? "governor" : body.newRole,
                p_reason: body.reason,
              },
              { get: false }
            )
          : await api.rpc(
              "review_frontend_staff_role",
              {
                p_decision: body.decisionId,
                p_action: body.action,
                ...(body.action === "approve" ? { p_version: body.payloadVersion } : {}),
                ...(body.note ? { p_note: body.note } : {}),
              },
              { get: false }
            );
      if (rpc.error?.code === "PT404")
        throw new FoundationStaffCommandError(404, "The account or role change was not found.");
      if (rpc.error?.code === "23514")
        throw new FoundationStaffCommandError(
          409,
          "The last active administrator cannot be removed."
        );
      if (rpc.error?.message === "owner-approved administrator invitation required")
        throw new FoundationStaffCommandError(
          403,
          "Only an owner-approved account can become a full administrator."
        );
      const result = await settleStaffCommand(
        Promise.resolve(rpc),
        z
          .strictObject({
            id: body.action === "propose" ? z.uuid() : z.literal(body.decisionId),
            status: z.enum(["proposed", "applied", "rejected", "withdrawn"]),
          })
          .refine((r) =>
            body.action === "approve"
              ? r.status === "applied"
              : body.action === "propose"
                ? ["proposed", "applied"].includes(r.status)
                : ["rejected", "withdrawn"].includes(r.status)
          )
      );
      return { success: true, status: result.status, decisionId: result.id };
    },
  });
}
