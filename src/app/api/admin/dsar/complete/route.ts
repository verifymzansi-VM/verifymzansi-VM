import { NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { sendDsarCompletedEmail } from "@/lib/services/email";
import { adminDsarCompleteSchema } from "@/lib/validations/admin";
import { getAdminActorRole } from "@/lib/auth/admin-access";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";

const log = createLogger("DSARComplete");

/**
 * POST /api/admin/dsar/complete
 *
 * Marks an in-progress DSAR request as completed after fulfillment.
 */
export async function POST(req: Request) {
  try {
    const originBlock = enforceSameOriginMutation(req, log);
    if (originBlock) return originBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const actorRole = getAdminActorRole(user);
    if (!actorRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:dsar:complete");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const body = await parseJsonRequest(req);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parsed = adminDsarCompleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { requestId, notes } = parsed.data;
    const completedAt = new Date().toISOString();
    const admin = createAdminClient();

    const { data: updated, error } = await admin
      .from("dsar_cases")
      .update({
        status: "completed",
        completed_at: completedAt,
        processed_by: user.id,
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
      actorId: user.id,
      actorRole,
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
