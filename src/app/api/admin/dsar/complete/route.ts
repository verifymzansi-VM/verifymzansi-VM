import { NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { sendDsarCompletedEmail } from "@/lib/services/email";
import { adminDsarCompleteSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { scheduleBackgroundTask } from "@/lib/utils/background-task";

const log = createLogger("DSARComplete");

/**
 * POST /api/admin/dsar/complete
 *
 * Marks an in-progress DSAR request as completed after fulfillment.
 * Requires identity verification first, and deletion-type cases require an
 * explicit operator attestation (see below).
 */
export async function POST(req: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request: req,
      logger: log,
      rateLimitAction: "admin:dsar:complete",
      capability: "dsar:manage",
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

    const { requestId, notes, deletionAttestation } = bodyResult.data;
    const completedAt = new Date().toISOString();
    const admin = createAdminClient();

    // Load the case first: identity verification and deletion attestation
    // gates need the current row before the CAS update below.
    const { data: dsarCase, error: caseError } = await admin
      .from("dsar_cases")
      .select("id, type, status, identity_verified")
      .eq("id", requestId)
      .maybeSingle();

    if (caseError) {
      log.error("DB error", { error: caseError.message });
      return NextResponse.json({ error: "Failed to load DSAR request" }, { status: 500 });
    }

    if (!dsarCase) {
      return NextResponse.json(
        { error: "Request not found or not ready for completion" },
        { status: 409 }
      );
    }

    // POPIA: never fulfill a request whose requester identity is unconfirmed.
    if (!dsarCase.identity_verified) {
      return NextResponse.json(
        {
          error: "Identity must be verified before completing this request",
          code: "identity_not_verified",
        },
        { status: 409 }
      );
    }

    // Deletion-type DSARs are executed by a manual operator process (there is
    // no automated data deletion). Completion therefore requires an explicit
    // attestation confirming the deletion was performed — this creates the
    // accountability trail without this endpoint touching user data itself.
    if (dsarCase.type === "deletion" && !deletionAttestation?.trim()) {
      return NextResponse.json(
        {
          error: "Deletion requests require a deletion attestation before completion",
          code: "deletion_attestation_required",
        },
        { status: 422 }
      );
    }

    const responseSummary =
      dsarCase.type === "deletion" && deletionAttestation
        ? [notes, `Deletion attestation: ${deletionAttestation}`].filter(Boolean).join("\n\n")
        : notes;

    const { data: updated, error } = await admin
      .from("dsar_cases")
      .update({
        status: "completed",
        completed_at: completedAt,
        processed_by: guard.user.id,
        ...(responseSummary ? { response_summary: responseSummary } : {}),
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
      metadata: {
        notes,
        completedAt,
        ...(deletionAttestation ? { deletionAttestation } : {}),
      },
    });

    const completedRequest = updated[0];
    const reference = `DSAR-${requestId.slice(0, 8).toUpperCase()}`;
    // scheduleBackgroundTask keeps the send alive after the response on
    // Cloudflare Workers (a bare unawaited chain can be dropped there).
    scheduleBackgroundTask(
      (async () => {
        const result = await sendDsarCompletedEmail(
          completedRequest.requester_email,
          reference,
          notes
        );
        if (!result.success) {
          log.warn("Failed to send DSAR completion email", {
            requestId,
            error: result.error ?? "unknown error",
          });
        }
      })(),
      "dsar completion email"
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
