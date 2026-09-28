import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { readStaffAccessFromDb, roleHasCapability } from "@/lib/auth/admin-access";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { uuidSchema } from "@/lib/validations/shared";

const log = createLogger("DsarCase");

const OPEN_STATUSES = ["submitted", "identity_pending", "in_progress"];

const caseActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("extend"),
    requestId: uuidSchema,
    reason: z.string().trim().min(10).max(1000),
  }),
  z.object({
    action: z.literal("assign"),
    requestId: uuidSchema,
    /** null clears the assignment. */
    assigneeId: uuidSchema.nullable(),
  }),
]);

const EXTEND_REFUSALS: Record<string, [number, string]> = {
  forbidden: [403, "Your role cannot extend deadlines."],
  reason_required: [400, "Give a reason of at least 10 characters."],
  not_found: [404, "Data request not found."],
  not_open: [409, "This request is already closed."],
  already_extended: [409, "This deadline has already been extended once."],
  extension_not_allowed: [409, "The deadline rules for this request type allow no extension."],
  already_overdue: [409, "An extension must be given before the deadline passes."],
};

/**
 * POST /api/admin/dsar/case
 *
 *   extend → move the deadline once, where the rules allow it, with a reason.
 *            The requester is notified by a durable email job.
 *   assign → give the case to someone who can handle data requests.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      capability: "dsar:manage",
      rateLimitAction: "admin:dsar:case",
    });
    if (!guard.success) return guard.response;

    const body = await parseAndValidateJsonRequest(request, caseActionSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;
    const input = body.data;
    const admin = createAdminClient();

    if (input.action === "extend") {
      const { data, error } = await admin.rpc("extend_dsar_deadline", {
        p_actor: guard.user.id,
        p_case: input.requestId,
        p_reason: input.reason,
      });
      if (error) throw new Error(`extend_dsar_deadline failed: ${error.message}`);
      const result = data as { ok: boolean; error?: string; due?: string };
      if (!result.ok) {
        const [status, message] = EXTEND_REFUSALS[result.error ?? ""] ?? [
          409,
          "The deadline could not be extended.",
        ];
        return NextResponse.json({ error: message, code: result.error }, { status });
      }
      return NextResponse.json({ status: "extended", due: result.due });
    }

    if (input.assigneeId) {
      const access = await readStaffAccessFromDb(input.assigneeId);
      if (!access || !roleHasCapability(access.role, "dsar:manage")) {
        return NextResponse.json(
          { error: "That person cannot handle data requests." },
          { status: 400 }
        );
      }
    }

    const { data: updated, error } = await admin
      .from("dsar_cases")
      .update({ assigned_to: input.assigneeId })
      .eq("id", input.requestId)
      .in("status", OPEN_STATUSES)
      .select("id");
    if (error) throw new Error(`DSAR assignment failed: ${error.message}`);
    if (!updated?.length) {
      return NextResponse.json(
        { error: "Data request not found or already closed." },
        { status: 409 }
      );
    }

    await logAuditEvent({
      action: "dsar_assigned",
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      targetType: "dsar_case",
      targetId: input.requestId,
      metadata: { assignee: input.assigneeId },
    });
    return NextResponse.json({ status: input.assigneeId ? "assigned" : "unassigned" });
  } catch (err) {
    logApiError(log, "DSAR case action failed", err);
    return internalApiError();
  }
}
