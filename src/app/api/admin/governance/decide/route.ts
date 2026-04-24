import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyCapabilityRoleFromDb } from "@/lib/auth/admin-access";
import { approveDecision, rejectDecision, escalateDecision } from "@/lib/services/decision-ledger";
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

const log = createLogger("GovernanceDecide");

const governanceDecideSchema = z.object({
  decisionId: uuidSchema,
  action: z.enum(["approve", "reject", "escalate"]),
  rationale: z.string().min(1).max(2000),
  afterState: z.record(z.string(), z.unknown()).optional(),
  secondaryApproverId: uuidSchema.optional(),
});

/**
 * High-stakes action categories that require dual approval (four-eyes principle).
 * For these categories, the approver must not be the recommender, and a
 * secondaryApproverId is required.
 */
const DUAL_APPROVAL_CATEGORIES: ReadonlySet<string> = new Set([
  "kyc_override",
  "account_ban",
  "data_deletion",
  "role_change",
  "policy_exception",
]);

/**
 * POST /api/admin/governance/decide
 *
 * Governance controller approves, rejects, or escalates a pending decision.
 * Requires decision:approve or decision:reject capability.
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

    const capability = "decision:approve";
    const actorRole = await verifyCapabilityRoleFromDb(user, capability);
    if (!actorRole) {
      return forbiddenResponse();
    }

    const rl = checkLocalRateLimit(user.id, "admin:governance:decide");
    if (rl.limited) {
      return rateLimitResponse(rl.retryAfter ?? 60);
    }

    const bodyResult = await parseAndValidateJsonRequest(request, governanceDecideSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { decisionId, action, rationale, afterState, secondaryApproverId } = bodyResult.data;

    // ── Dual approval enforcement for high-stakes actions ────
    if (action === "approve" || action === "reject") {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const adminSupabase = createAdminClient();
      const { data: decision } = await adminSupabase
        .from("decision_records")
        .select("recommender_id, action_category")
        .eq("id", decisionId)
        .maybeSingle();

      if (!decision) {
        return NextResponse.json({ error: "Decision record not found" }, { status: 404 });
      }

      // Four-eyes principle: approver must differ from recommender
      if (decision.recommender_id === user.id) {
        return NextResponse.json(
          { error: "Cannot approve/reject your own recommendation" },
          { status: 403 }
        );
      }

      // High-stakes categories require a secondary approver
      if (
        action === "approve" &&
        DUAL_APPROVAL_CATEGORIES.has(decision.action_category) &&
        !secondaryApproverId
      ) {
        return NextResponse.json(
          {
            error: "Dual approval required",
            detail:
              "High-stakes decisions require a secondary approver. Provide secondaryApproverId.",
          },
          { status: 422 }
        );
      }
    }

    if (action === "approve") {
      const result = await approveDecision({
        decisionId,
        approverId: user.id,
        approverRole: actorRole,
        rationale,
        afterState: afterState ?? {},
        secondaryApproverId,
      });
      if (!result) {
        return NextResponse.json(
          { error: "Decision not found or not in approvable state" },
          { status: 409 }
        );
      }
      return NextResponse.json({ status: "approved", decisionId });
    }

    if (action === "reject") {
      const result = await rejectDecision({
        decisionId,
        approverId: user.id,
        approverRole: actorRole,
        rationale,
      });
      if (!result) {
        return NextResponse.json(
          { error: "Decision not found or not in rejectable state" },
          { status: 409 }
        );
      }
      return NextResponse.json({ status: "rejected", decisionId });
    }

    if (action === "escalate") {
      const result = await escalateDecision({
        decisionId,
        actorId: user.id,
        actorRole,
        reason: rationale,
      });
      if (!result) {
        return NextResponse.json(
          { error: "Decision not found or already escalated" },
          { status: 409 }
        );
      }
      return NextResponse.json({ status: "escalated", decisionId });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    logApiError(log, "Unexpected error", err);
    return internalApiError();
  }
}
