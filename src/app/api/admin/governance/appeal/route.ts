import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyCapabilityRoleFromDb } from "@/lib/auth/admin-access";
import { resolveAppeal } from "@/lib/services/decision-ledger";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import {
  internalApiError,
  logApiError,
  parseAndValidateJsonRequest,
  unauthorizedResponse,
  forbiddenResponse,
  rateLimitResponse,
} from "@/lib/utils/api";
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
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return unauthorizedResponse();
    }

    const actorRole = await verifyCapabilityRoleFromDb(user, "appeal:decide");
    if (!actorRole) {
      return forbiddenResponse();
    }

    const rl = checkLocalRateLimit(user.id, "admin:governance:appeal");
    if (rl.limited) {
      return rateLimitResponse(rl.retryAfter ?? 60);
    }

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
      reviewerId: user.id,
      reviewerRole: actorRole,
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
