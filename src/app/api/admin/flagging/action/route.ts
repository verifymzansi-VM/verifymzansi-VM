import { NextResponse } from "next/server";
import { adminFlaggingActionSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { decisionRefusalResponse, moderateReport } from "@/lib/services/decision-ledger";
import { checkQueueClaim, releaseDecidedClaim } from "@/lib/services/queue-claims";

const log = createLogger("AdminFlagging");

const SUCCESS_MESSAGES: Record<string, string> = {
  dismissed: "Report dismissed.",
  applied: "Action applied.",
  proposed: "Sent for approval. Someone else must approve it before it takes effect.",
  emergency_applied:
    "Emergency suspension applied for 72 hours. Someone else must approve the full action before then.",
};

/**
 * POST /api/admin/flagging/action
 *
 * Act on a report. The database applies the policy in one transaction
 * (moderate_report): any staff member may dismiss or warn; governors and
 * admins may hide the reported item; suspensions and bans are proposals that
 * another governor or admin approves, except emergency containment (a
 * 72-hour suspension by a governor or admin, reviewed by someone else).
 * Nobody acts on a report they filed or one about their own account.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      rateLimitAction: "admin:flagging:action",
      rateLimitMessage: "Too many requests",
    });
    if (!guard.success) return guard.response;

    const parsedBody = await parseAndValidateJsonRequest(request, adminFlaggingActionSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!parsedBody.success) return parsedBody.response;

    const { reportId, action, reason, durationDays, emergency } = parsedBody.data;

    const claimBlock = await checkQueueClaim(guard.user.id, { type: "report", id: reportId });
    if (claimBlock) return claimBlock;

    // Bans and suspensions fail closed when the shared limiter is unavailable.
    if (action === "ban" || action === "suspend") {
      const enforceRl = await checkSensitiveActionRateLimit(
        guard.user.id,
        "admin:flagging:enforce"
      );
      if (enforceRl.limited) {
        return NextResponse.json(
          { error: "Too many requests", retryAfter: enforceRl.retryAfter ?? 60 },
          { status: 429, headers: { "Retry-After": String(enforceRl.retryAfter ?? 60) } }
        );
      }
    }

    const result = await moderateReport(guard.user.id, {
      reportId,
      action,
      reason: reason ?? null,
      durationDays: durationDays ?? null,
      emergency: emergency ?? false,
    });
    if (!result.ok) return decisionRefusalResponse(result.error);
    await releaseDecidedClaim(guard.user.id, { type: "report", id: reportId });

    return NextResponse.json({
      success: true,
      action,
      status: result.status,
      decisionId: result.decision_id ?? null,
      reviewDecisionId: result.review_decision_id ?? null,
      message: SUCCESS_MESSAGES[result.status] ?? "Done.",
    });
  } catch (error) {
    logApiError(log, "Flagging action failed", error);
    return internalApiError();
  }
}
