import { NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { sendDsarCompletedEmail } from "@/lib/services/email";
import { adminDsarCompleteSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";

const log = createLogger("DSARComplete");

/**
 * POST /api/admin/dsar/complete
 *
 * Marks an in-progress DSAR request as completed after fulfillment.
 */
export async function POST(req: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request: req,
      logger: log,
      rateLimitAction: "admin:dsar:complete",
      adminOnly: true,
    });
    if (!guard.success) return guard.response;

    const bodyResult = await parseAndValidateJsonRequest(req, adminDsarCompleteSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { requestId, notes } = bodyResult.data;
    const completedAt = new Date().toISOString();
    const admin = createAdminClient();

    const { data: updated, error } = await admin
      .from("dsar_cases")
      .update({
        status: "completed",
        completed_at: completedAt,
        processed_by: guard.user.id,
        ...(notes ? { response_summary: notes } : {}),
      })
      .eq("id", requestId)
      .eq("status", "in_progress")
      .select("id, requester_email");

    if (error) {
      log.error("DB error", { error: error.message });
      return NextResponse.json({ error: "Failed to complete DSAR request" }, { status: 500 });
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: "Request not found or not ready for completion" },
        { status: 409 }
      );
    }

    await logAuditEvent({
      action: "dsar_completed",
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      targetId: requestId,
      targetType: "dsar_case",
      metadata: { notes, completedAt },
    });

    const completedRequest = updated[0];
    const reference = `DSAR-${requestId.slice(0, 8).toUpperCase()}`;
    sendDsarCompletedEmail(completedRequest.requester_email, reference, notes).catch(
      (emailError) => {
        log.warn("Failed to send DSAR completion email", {
          requestId,
          error: emailError instanceof Error ? emailError.message : "unknown error",
        });
      }
    );

    return NextResponse.json({ status: "completed", completedAt });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
