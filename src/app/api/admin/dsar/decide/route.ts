import { NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { adminDsarDecideSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";

const log = createLogger("DSARDecide");

/**
 * POST /api/admin/dsar/decide
 *
 * Updates a DSAR request status (approve → in_progress/completed, reject → rejected).
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
      .select("id");

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

    return NextResponse.json({ status: newStatus });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
