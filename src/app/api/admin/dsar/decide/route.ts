import { NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { sendDsarRejectedEmail } from "@/lib/services/email";
import { adminDsarDecideSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { scheduleBackgroundTask } from "@/lib/utils/background-task";

const log = createLogger("DSARDecide");

/**
 * POST /api/admin/dsar/decide
 *
 * Updates a DSAR request:
 *   approve         → in_progress
 *   reject          → rejected (+ rejection notification email)
 *   verify_identity → identity_verified = true (unblocks export/complete)
 */
export async function POST(req: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request: req,
      logger: log,
      rateLimitAction: "admin:dsar:decide",
      capability: "dsar:manage",
    });
    if (!guard.success) return guard.response;

    const bodyResult = await parseAndValidateJsonRequest(req, adminDsarDecideSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { requestId, decision, notes } = bodyResult.data;

    const admin = createAdminClient();

    // ── Identity verification ──────────────────────────────
    // POPIA requires the requester's identity to be confirmed before any
    // personal data is exported or the case is completed.
    if (decision === "verify_identity") {
      const { data: verified, error: verifyError } = await admin
        .from("dsar_cases")
        .update({
          identity_verified: true,
          processed_by: guard.user.id,
        })
        .eq("id", requestId)
        .in("status", ["submitted", "in_progress"]) // CAS guard — never reopen final states
        .select("id");

      if (verifyError) {
        log.error("DB error", { error: verifyError.message });
        return NextResponse.json({ error: "Failed to update DSAR request" }, { status: 500 });
      }

      if (!verified || verified.length === 0) {
        return NextResponse.json(
          { error: "Request not found or already processed" },
          { status: 409 }
        );
      }

      await logAuditEvent({
        action: "dsar_identity_verified",
        actorId: guard.user.id,
        actorRole: guard.actorRole,
        targetId: requestId,
        targetType: "dsar_case",
        metadata: { decision, notes },
      });

      return NextResponse.json({ status: "identity_verified" });
    }

    const newStatus = decision === "approve" ? "in_progress" : "rejected";

    const { data: updated, error } = await admin
      .from("dsar_cases")
      .update({
        status: newStatus,
        processed_by: guard.user.id,
        ...(notes ? { response_summary: notes } : {}),
      })
      .eq("id", requestId)
      .eq("status", "submitted") // Only update submitted requests (CAS guard)
      .select("id, requester_email");

    if (error) {
      log.error("DB error", { error: error.message });
      return NextResponse.json({ error: "Failed to update DSAR request" }, { status: 500 });
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: "Request not found or already processed" },
        { status: 409 }
      );
    }

    await logAuditEvent({
      action: decision === "approve" ? "dsar_started" : "dsar_rejected",
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      targetId: requestId,
      targetType: "dsar_case",
      metadata: { decision, notes },
    });

    // Notify the requester about rejections — a silent rejection leaves the
    // data subject without the feedback POPIA expects.
    if (decision === "reject") {
      const rejectedRequest = updated[0];
      const reference = `DSAR-${requestId.slice(0, 8).toUpperCase()}`;
      scheduleBackgroundTask(
        (async () => {
          const result = await sendDsarRejectedEmail(
            rejectedRequest.requester_email,
            reference,
            notes
          );
          if (!result.success) {
            log.warn("Failed to send DSAR rejection email", {
              requestId,
              error: result.error ?? "unknown error",
            });
          }
        })(),
        "dsar rejection email"
      );
    }

    return NextResponse.json({ status: newStatus });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
