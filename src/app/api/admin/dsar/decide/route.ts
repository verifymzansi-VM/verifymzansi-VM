import { NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { adminDsarDecideSchema } from "@/lib/validations/admin";
import { verifyCapabilityRoleFromDb } from "@/lib/auth/admin-access";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";

const log = createLogger("DSARDecide");

/**
 * POST /api/admin/dsar/decide
 *
 * Updates a DSAR request status (approve → in_progress/completed, reject → rejected).
 */
export async function POST(req: Request) {
  try {
    const originBlock = enforceSameOriginMutation(req, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(req, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const actorRole = await verifyCapabilityRoleFromDb(user, "dsar:manage");
    if (!actorRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:dsar:decide");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

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
        processed_by: user.id,
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
      actorId: user.id,
      actorRole,
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
