import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { decisionRefusalResponse, resolveAppeal } from "@/lib/services/decision-ledger";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { uuidSchema } from "@/lib/validations/shared";
import { getDataBackend } from "@/lib/data-backend";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";
import { appealOutcome } from "@/lib/foundation/member-appeals";

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
const nativeResolveSchema = appealResolveSchema
  .safeExtend({
    effectVersion: z.number().int().min(1).max(2147483646).optional(),
  })
  .strict()
  .refine((v) => (v.status === "partially_overturned") === Boolean(v.shortenTo));

/**
 * POST /api/admin/governance/appeal
 *
 * Decide an appeal. The reviewer must not have taken part in the decision
 * being appealed. Overturning lifts only that decision's restrictions and
 * restores only the content it hid; a partial overturn shortens a suspension.
 */
export async function POST(request: Request) {
  if (getDataBackend() === "foundation")
    return handleFoundationOwnerRoute({
      request: request instanceof NextRequest ? request : new NextRequest(request),
      log,
      action: "admin:governance:appeal",
      mutate: true,
      maxBytes: 13500,
      signInMessage: "Sign in to review appeals",
      unavailableMessage:
        "The resolution could not be confirmed. Reload the appeal before trying again.",
      refusal: staffCommandRefusal,
      command: async (api, body) => {
        const input = nativeResolveSchema.parse(body);
        const result = await settleStaffCommand(
          api.rpc(
            "resolve_frontend_appeal",
            {
              p_appeal: input.appealId,
              p_outcome: input.status,
              p_reason: input.rationale,
              ...(input.effectVersion !== undefined
                ? { p_effect_version: input.effectVersion }
                : {}),
              ...(input.shortenTo ? { p_shorten_to: input.shortenTo } : {}),
            },
            { get: false }
          ),
          z.strictObject({
            appeal_id: z.literal(input.appealId),
            status: appealOutcome.refine((value) => value === input.status),
            restrictions_changed: z.number().int().min(0).max(1),
            reused: z.boolean().optional(),
          })
        );
        return {
          status: result.status,
          appealId: result.appeal_id,
          restrictionsChanged: result.restrictions_changed,
        };
      },
    });
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
