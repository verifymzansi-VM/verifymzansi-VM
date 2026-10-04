import { NextResponse } from "next/server";
import { z } from "zod";
import {
  approveDecision,
  decisionRefusalResponse,
  escalateDecision,
  markDecisionExecution,
  rejectDecision,
} from "@/lib/services/decision-ledger";
import { applyVerificationDecision } from "@/lib/services/verification-decision";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { reportCriticalIncident } from "@/lib/utils/alerts";
import {
  internalApiError,
  logApiError,
  parseAndValidateJsonRequest,
  rateLimitResponse,
} from "@/lib/utils/api";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { uuidSchema } from "@/lib/validations/shared";
import type { StaffRole } from "@/types/enums";

const log = createLogger("GovernanceDecide");

const governanceDecideSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    decisionId: uuidSchema,
    payloadVersion: z.number().int().min(1),
    rationale: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("reject"),
    decisionId: uuidSchema,
    rationale: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("escalate"),
    decisionId: uuidSchema,
    rationale: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("retry_execution"),
    decisionId: uuidSchema,
  }),
]);

/**
 * POST /api/admin/governance/decide
 *
 * Approve, reject or escalate a pending decision, or retry the execution of
 * an approved one. Approval runs in one database transaction that checks
 * the approver's role and independence (not the proposer, the person
 * affected, the reporter or anyone who already took part) and applies the
 * decision's effects. KYC overrides then run the verification workflow and
 * record whether it succeeded; a failure stays visible and retryable.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      capability: "decision:approve",
      rateLimitAction: "admin:governance:request",
      stepUp: true,
    });
    if (!guard.success) return guard.response;

    const rateLimit = await checkSensitiveActionRateLimit(
      guard.user.id,
      "admin:governance:decide",
      10
    );
    if (rateLimit.limited) return rateLimitResponse(rateLimit.retryAfter ?? 60);

    const body = await parseAndValidateJsonRequest(request, governanceDecideSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;
    const input = body.data;

    if (input.action === "escalate") {
      const result = await escalateDecision({
        decisionId: input.decisionId,
        actorId: guard.user.id,
        actorRole: guard.actorRole,
        reason: input.rationale,
      });
      if (!result) {
        return NextResponse.json(
          { error: "Decision not found or already escalated" },
          { status: 409 }
        );
      }
      return NextResponse.json({ status: "escalated", decisionId: input.decisionId });
    }

    if (input.action === "reject") {
      const result = await rejectDecision(guard.user.id, input.decisionId, input.rationale);
      if (!result.ok) return decisionRefusalResponse(result.error);
      return NextResponse.json({ status: result.status, decisionId: input.decisionId });
    }

    if (input.action === "retry_execution") {
      if (guard.actorRole !== "admin") {
        return NextResponse.json(
          { error: "Only an admin can retry an execution" },
          { status: 403 }
        );
      }
      return await retryExecution(input.decisionId, guard.user.id, guard.actorRole);
    }

    const result = await approveDecision(
      guard.user.id,
      input.decisionId,
      input.payloadVersion,
      input.rationale
    );
    if (!result.ok) return decisionRefusalResponse(result.error);

    if (result.execution === "pending" && result.payload) {
      const executed = await executeKycOverride(
        input.decisionId,
        result.payload,
        guard.user.id,
        guard.actorRole,
        false
      );
      if (!executed.ok) {
        return NextResponse.json(
          {
            error: "Approved, but the verification update failed. An admin can retry it.",
            code: "execution_failed",
            decisionId: input.decisionId,
          },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ status: result.status, decisionId: input.decisionId });
  } catch (err) {
    logApiError(log, "Unexpected error", err);
    return internalApiError();
  }
}

async function executeKycOverride(
  decisionId: string,
  payload: Record<string, unknown>,
  reviewerId: string,
  reviewerRole: StaffRole,
  isRetry: boolean
): Promise<{ ok: boolean }> {
  const stepId = typeof payload.step_id === "string" ? payload.step_id : null;
  const overrideReasonCode =
    typeof payload.override_reason_code === "string" ? payload.override_reason_code : null;
  const submissionUpdatedAt =
    typeof payload.step_updated_at === "string" ? payload.step_updated_at : null;
  const ownerId = typeof payload.user_id === "string" ? payload.user_id : null;

  let error = "The reviewed submission is unavailable; request a new review";
  if (
    stepId &&
    ownerId &&
    submissionUpdatedAt &&
    Number.isFinite(Date.parse(submissionUpdatedAt))
  ) {
    const { data: step } = await createAdminClient()
      .from("verification_steps")
      .select("*")
      .eq("id", stepId)
      .maybeSingle();
    if (step && step.user_id === ownerId && step.user_id !== reviewerId) {
      const applied = await applyVerificationDecision({
        step,
        decision: "approved",
        overrideReasonCode,
        reviewerId,
        reviewerRole,
        allowAlreadyApplied: isRetry,
        overrideDecisionId: decisionId,
        expectedSubmissionUpdatedAt: submissionUpdatedAt,
      });
      if (applied.ok) {
        await markDecisionExecution(decisionId, true);
        return { ok: true };
      }
      error = applied.error;
    }
  }

  await markDecisionExecution(decisionId, false, error);
  reportCriticalIncident("GovernanceDecide", "Approved KYC override could not be applied", {
    decisionId,
    stepId,
    error,
  });
  return { ok: false };
}

async function retryExecution(decisionId: string, actorId: string, actorRole: StaffRole) {
  const { data: decision } = await createAdminClient()
    .from("decision_records")
    .select("id, status, action_category, execution_status, payload, approver_id, recommender_id")
    .eq("id", decisionId)
    .maybeSingle();
  if (
    !decision ||
    decision.status !== "approved" ||
    decision.action_category !== "kyc_override" ||
    decision.execution_status !== "failed"
  ) {
    return NextResponse.json({ error: "Nothing to retry for this decision" }, { status: 409 });
  }

  if (decision.recommender_id === actorId || decision.payload?.user_id === actorId) {
    return decisionRefusalResponse("not_independent");
  }

  // The admin who retries is recorded as the reviewer of the step.
  const executed = await executeKycOverride(
    decisionId,
    (decision.payload ?? {}) as Record<string, unknown>,
    actorId,
    actorRole,
    true
  );
  return executed.ok
    ? NextResponse.json({ status: "executed", decisionId })
    : NextResponse.json(
        { error: "The verification update failed again.", code: "execution_failed", decisionId },
        { status: 502 }
      );
}
