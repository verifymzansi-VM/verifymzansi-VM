import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isModeratorOrAdmin } from "@/lib/auth/roles";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { z } from "zod";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("PromotionModeration");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const moderateSchema = z.object({
  decision: z.enum(["approve", "reject", "hide"]),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/admin/promotions/[id]/moderate
 *
 * Approve, reject, or hide a promotion.
 * Requires moderator or admin role.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: promotionId } = await params;

    if (!UUID_RE.test(promotionId)) {
      return NextResponse.json({ error: "Invalid promotion ID" }, { status: 400 });
    }

    // Auth + role check
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !isModeratorOrAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsedBody = await parseAndValidateJsonRequest(request, moderateSchema, {
      invalidJsonMessage: "Invalid JSON body",
      validationErrorMessage: "Validation failed",
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { decision, reason } = parsedBody.data;
    const admin = createAdminClient();

    // Fetch current promotion
    const { data: promotion } = await admin
      .from("promotions")
      .select("id, status, owner_id, title, published_at")
      .eq("id", promotionId)
      .maybeSingle();

    if (!promotion) {
      return NextResponse.json({ error: "Promotions & Events post not found" }, { status: 404 });
    }

    // Map decision to status
    const statusMap: Record<string, string> = {
      approve: "live",
      reject: "rejected",
      hide: "hidden",
    };

    const newStatus = statusMap[decision];
    const updateData: Record<string, unknown> = {
      status: newStatus,
      status_reason: reason || null,
    };

    if (decision === "approve" && !promotion.published_at) {
      updateData.published_at = new Date().toISOString();
    }

    const { error: updateError } = await admin
      .from("promotions")
      .update(updateData)
      .eq("id", promotionId);

    if (updateError) {
      log.error("Failed to moderate Promotions & Events post", { error: updateError.message });
      return NextResponse.json(
        { error: "Failed to moderate Promotions & Events post" },
        { status: 500 }
      );
    }

    // Audit
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "admin",
        action: "moderation_action",
        targetType: "promotion",
        targetId: promotionId,
        metadata: { decision, reason, title: promotion.title },
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err) {
    logApiError(log, "Unexpected error moderating promotion", err);
    return internalApiError("Failed to moderate Promotions & Events post");
  }
}
