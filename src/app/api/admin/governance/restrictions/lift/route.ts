import { NextResponse } from "next/server";
import { z } from "zod";
import { decisionRefusalResponse, liftRestriction } from "@/lib/services/decision-ledger";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { uuidSchema } from "@/lib/validations/shared";

const log = createLogger("GovernanceLiftRestriction");

const liftSchema = z.object({
  restrictionId: uuidSchema,
  reason: z.string().trim().min(10).max(1000),
});

/**
 * POST /api/admin/governance/restrictions/lift
 *
 * Lift a warning, suspension or ban outside an appeal. The person lifting it
 * must not have taken part in imposing it. Content the restriction hid is
 * restored only when no other suspension or ban on the account remains.
 */
export async function POST(request: Request) {
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
