import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { decisionRefusalResponse, liftRestriction } from "@/lib/services/decision-ledger";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { uuidSchema } from "@/lib/validations/shared";
import { getDataBackend } from "@/lib/data-backend";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("GovernanceLiftRestriction");

const liftSchema = z.object({
  restrictionId: uuidSchema,
  reason: z.string().trim().min(10).max(1000),
});
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
  if (getDataBackend() === "foundation")
    return handleFoundationOwnerRoute({
      request: request instanceof NextRequest ? request : new NextRequest(request),
      log,
      action: "admin:governance:lift",
      mutate: true,
      unavailableMessage:
        "The lift could not be confirmed. Reload restrictions before trying again.",
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
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      capability: "enforcement:execute",
      rateLimitAction: "admin:governance:lift",
    });
    if (!guard.success) return guard.response;

    const body = await parseAndValidateJsonRequest(request, liftSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;

    const result = await liftRestriction(guard.user.id, body.data.restrictionId, body.data.reason);
    if (!result.ok) return decisionRefusalResponse(result.error);
    return NextResponse.json({ status: "lifted", decisionId: result.decision_id });
  } catch (err) {
    logApiError(log, "Unexpected error", err);
    return internalApiError();
  }
}
