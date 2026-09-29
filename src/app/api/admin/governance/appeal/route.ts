import { NextResponse } from "next/server";
import { z } from "zod";
import { decisionRefusalResponse, resolveAppeal } from "@/lib/services/decision-ledger";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { uuidSchema } from "@/lib/validations/shared";

const log = createLogger("GovernanceAppeal");

const appealResolveSchema = z
  .object({
    appealId: uuidSchema,
    status: z.enum(["upheld", "overturned", "partially_overturned", "dismissed"]),
    rationale: z.string().trim().min(10).max(2000),
    /** For a partial overturn: the new end of the suspension. */
    shortenTo: z.string().datetime({ offset: true }).optional(),
  })
  .refine((body) => body.status !== "partially_overturned" || body.shortenTo, {
    message: "Choose the new end date for a partial overturn",
    path: ["shortenTo"],
  });

/**
 * POST /api/admin/governance/appeal
 *
 * Decide an appeal. The reviewer must not have taken part in the decision
 * being appealed. Overturning lifts only that decision's restrictions and
 * restores only the content it hid; a partial overturn shortens a suspension.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      capability: "appeal:decide",
      rateLimitAction: "admin:governance:appeal",
    });
    if (!guard.success) return guard.response;

    const body = await parseAndValidateJsonRequest(request, appealResolveSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;

    const { appealId, status, rationale, shortenTo } = body.data;
    const result = await resolveAppeal(guard.user.id, appealId, status, rationale, shortenTo);
    if (!result.ok) return decisionRefusalResponse(result.error);

    return NextResponse.json({
      status,
      appealId,
      restrictionsChanged: result.restrictions_changed,
    });
  } catch (err) {
    logApiError(log, "Unexpected error", err);
    return internalApiError();
  }
}
