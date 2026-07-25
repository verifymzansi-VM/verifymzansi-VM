import { NextResponse } from "next/server";
import { approveDecision, rejectDecision, escalateDecision } from "@/lib/services/decision-ledger";
import { enforceAction, type EnforcementAction } from "@/lib/services/enforcement";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { hasCapability } from "@/lib/auth/roles";
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
 * Decision categories whose approval executes account enforcement.
 * The recommendation text (e.g. "ban"/"suspend" from the flagging workflow)
 * wins when it is itself an enforceable action; otherwise the category maps
 * to its canonical enforcement action.
 */
const ENFORCEMENT_CATEGORY_ACTIONS: Record<string, EnforcementAction> = {
  account_ban: "ban",
  account_suspend: "suspend",
};
const ENFORCEABLE_RECOMMENDATIONS: ReadonlySet<string> = new Set([
  "warning",
  "suspend",
  "ban",
  "unban",
]);

interface DecisionRow {
  recommender_id: string;
  action_category: string;
  case_type: string;
  case_id: string;
  recommendation: string;
  before_state: unknown;
}

/**
 * Resolve the enforcement action implied by an approved decision, or null
 * when the decision category carries no direct account enforcement.
 */
function resolveEnforcementAction(decision: DecisionRow): EnforcementAction | null {
  if (ENFORCEABLE_RECOMMENDATIONS.has(decision.recommendation)) {
    return decision.recommendation as EnforcementAction;
  }
  return ENFORCEMENT_CATEGORY_ACTIONS[decision.action_category] ?? null;
}

/**
 * POST /api/admin/governance/decide
 *
 * Governance controller approves, rejects, or escalates a pending decision.
 * Requires decision:approve or decision:reject capability.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      capability: "decision:approve",
      rateLimitAction: "admin:governance:decide",
    });
    if (!guard.success) return guard.response;

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
    let decision: DecisionRow | null = null;
    if (action === "approve" || action === "reject") {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const adminSupabase = createAdminClient();
      const { data: decisionRow } = await adminSupabase
        .from("decision_records")
        .select("recommender_id, action_category, case_type, case_id, recommendation, before_state")
        .eq("id", decisionId)
        .maybeSingle();

      if (!decisionRow) {
        return NextResponse.json({ error: "Decision record not found" }, { status: 404 });
      }
      decision = decisionRow as DecisionRow;

      // Four-eyes principle: approver must differ from recommender
      if (decision.recommender_id === guard.user.id) {
        return NextResponse.json(
          { error: "Cannot approve/reject your own recommendation" },
          { status: 403 }
        );
      }

      // High-stakes categories require a secondary approver
      if (action === "approve" && DUAL_APPROVAL_CATEGORIES.has(decision.action_category)) {
        if (!secondaryApproverId) {
          return NextResponse.json(
            {
              error: "Dual approval required",
              detail:
                "High-stakes decisions require a secondary approver. Provide secondaryApproverId.",
            },
            { status: 422 }
          );
        }

        // The secondary approver must be a distinct, independent staff member:
        // not the primary approver and not the original recommender.
        if (secondaryApproverId === guard.user.id) {
          return NextResponse.json(
            { error: "Secondary approver must differ from the primary approver" },
            { status: 422 }
          );
        }
        if (secondaryApproverId === decision.recommender_id) {
          return NextResponse.json(
            { error: "Secondary approver must differ from the recommender" },
            { status: 422 }
          );
        }

        // DB-verify the secondary approver exists and actually holds the
        // decision:approve capability (presence of a UUID is not approval).
        const { data: secondaryData, error: secondaryError } =
          await adminSupabase.auth.admin.getUserById(secondaryApproverId);
        if (
          secondaryError ||
          !secondaryData?.user ||
          !hasCapability(secondaryData.user, "decision:approve")
        ) {
          return NextResponse.json(
            { error: "Secondary approver is not an authorized decision approver" },
            { status: 422 }
          );
        }
      }
    }

    if (action === "approve") {
      const result = await approveDecision({
        decisionId,
        approverId: guard.user.id,
        approverRole: guard.actorRole,
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

      // ── Execute approved enforcement ─────────────────────
      // Approving an enforcement recommendation (ban/suspend/warn) must
      // actually apply it — the ledger records intent, enforceAction acts.
      if (decision) {
        const enforcementAction = resolveEnforcementAction(decision);
        const beforeState =
          decision.before_state && typeof decision.before_state === "object"
            ? (decision.before_state as Record<string, unknown>)
            : {};
        const ownerId = typeof beforeState.ownerId === "string" ? beforeState.ownerId : null;

        if (enforcementAction && ownerId) {
          try {
            await enforceAction({
              ownerId,
              action: enforcementAction,
              reason: rationale,
              moderatorId: guard.user.id,
              reportId: decision.case_type === "report" ? decision.case_id : undefined,
            });
          } catch (enforcementErr) {
            // The decision IS finalized (retrying this route now 409s), so
            // surface the failure distinctly — an operator must re-apply the
            // enforcement manually (e.g. via the flagging action route).
            log.error("Decision approved but enforcement execution failed", {
              decisionId,
              enforcementAction,
              ownerId,
              error: enforcementErr instanceof Error ? enforcementErr.message : "Unknown",
            });
            await logAuditEvent({
              actorId: guard.user.id,
              actorRole: guard.actorRole,
              action: "moderation_action",
              targetType: decision.case_type,
              targetId: decision.case_id,
              metadata: {
                decisionId,
                enforcement: "failed",
                enforcementAction,
                error: enforcementErr instanceof Error ? enforcementErr.message : "Unknown",
              },
            });
            return NextResponse.json(
              {
                error: "Decision approved but enforcement execution failed — re-apply manually",
                code: "enforcement_failed",
                decisionId,
              },
              { status: 502 }
            );
          }
        }
      }

      return NextResponse.json({ status: "approved", decisionId });
    }

    if (action === "reject") {
      const result = await rejectDecision({
        decisionId,
        approverId: guard.user.id,
        approverRole: guard.actorRole,
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
        actorId: guard.user.id,
        actorRole: guard.actorRole,
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
