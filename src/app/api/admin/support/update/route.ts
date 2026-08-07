import { NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { adminSupportUpdateSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";

const log = createLogger("AdminSupportUpdate");

/**
 * POST /api/admin/support/update
 *
 * Updates a contact_submissions row status:
 *   new → in_progress → resolved (any transition allowed; CAS guard on id only)
 */
export async function POST(req: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request: req,
      logger: log,
      rateLimitAction: "admin:support:update",
      capability: "case:recommend",
    });
    if (!guard.success) return guard.response;

    const bodyResult = await parseAndValidateJsonRequest(req, adminSupportUpdateSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { submissionId, status } = bodyResult.data;

    const admin = createAdminClient();
    const { data: updated, error } = await admin
      .from("contact_submissions")
      .update({ status })
      .eq("id", submissionId)
      .select("id");

    if (error) {
      log.error("DB error", { error: error.message });
      return NextResponse.json({ error: "Failed to update submission" }, { status: 500 });
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    await logAuditEvent({
      action: "support_submission_status_updated",
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      targetId: submissionId,
      targetType: "contact_submission",
      metadata: { status },
    });

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to update submission" }, { status: 500 });
  }
}
