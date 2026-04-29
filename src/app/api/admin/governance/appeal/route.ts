import { NextResponse } from "next/server";
import { resolveAppeal } from "@/lib/services/decision-ledger";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { z } from "zod";
import { uuidSchema } from "@/lib/validations/shared";
import type { AppealStatus } from "@/types/enums";

const log = createLogger("GovernanceAppeal");

const appealResolveSchema = z.object({
  appealId: uuidSchema,
  status: z.enum(["upheld", "overturned", "partially_overturned", "dismissed"]),
  rationale: z.string().min(1).max(2000),
  outcomeDetail: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/admin/governance/appeal
 *
 * Governance controller resolves an appeal case.
 * Requires appeal:decide capability.
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

    const bodyResult = await parseAndValidateJsonRequest(request, appealResolveSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { appealId, status, rationale, outcomeDetail } = bodyResult.data;

    const result = await resolveAppeal({
      appealId,
      reviewerId: guard.user.id,
      reviewerRole: guard.actorRole,
      status: status as Extract<
        AppealStatus,
        "upheld" | "overturned" | "partially_overturned" | "dismissed"
      >,
      rationale,
      outcomeDetail,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Appeal not found or not in resolvable state" },
        { status: 409 }
      );
    }

    return NextResponse.json({ status, appealId });
  } catch (err) {
    logApiError(log, "Unexpected error", err);
    return internalApiError();
  }
}
