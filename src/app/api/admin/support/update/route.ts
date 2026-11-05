import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { adminSupportUpdateSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { getDataBackend } from "@/lib/data-backend";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("AdminSupportUpdate");

/**
 * POST /api/admin/support/update
 *
 * Updates a contact_submissions row status:
 *   new → in_progress → resolved (any transition allowed; CAS guard on id only)
 */
export async function POST(req: Request) {
  if (getDataBackend() === "foundation")
    return handleFoundationOwnerRoute({
      request: req instanceof NextRequest ? req : new NextRequest(req),
      log,
      action: "admin:support:update",
      mutate: true,
      signInMessage: "Sign in to update support requests",
      unavailableMessage: "The status could not be confirmed. Reload the support inbox.",
      refusal: staffCommandRefusal,
      command: async (api, body) => {
        const input = adminSupportUpdateSchema
          .extend({ revision: z.number().int().min(1).max(2147483646) })
          .strict()
          .parse(body);
        await settleStaffCommand(
          api.rpc(
            "update_frontend_support_status",
            { p_ticket: input.submissionId, p_revision: input.revision, p_status: input.status },
            { get: false }
          ),
          z.strictObject({
            id: z.literal(input.submissionId),
            status: z.literal(input.status),
            revision: z
              .number()
              .int()
              .min(input.revision)
              .max(input.revision + 1),
          })
        );
        return { status: "ok" };
      },
    });
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
