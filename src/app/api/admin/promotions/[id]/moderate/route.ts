import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { z } from "zod";
import {
  internalApiError,
  logApiError,
  parseAndValidateJsonRequest,
  parseAndValidateRouteParams,
} from "@/lib/utils/api";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { uuidSchema } from "@/lib/validations/shared";

const log = createLogger("PromotionModeration");
const promotionModerationParamsSchema = z.object({
  id: uuidSchema,
});

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
    // ── CSRF protection ───────────────────────────────────────
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    const parsedParams = parseAndValidateRouteParams(
      await params,
      promotionModerationParamsSchema,
      {
        validationErrorMessage: "Invalid promotion ID",
        includeValidationDetails: false,
      }
    );
    if (!parsedParams.success) {
      return parsedParams.response;
    }
    const { id: promotionId } = parsedParams.data;

    // Auth + role check
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const adminRole = await verifyStaffActorRoleFromDb(user);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!adminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:promotions:moderate");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
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
      return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
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
      .eq("id", promotionId)
      .in("status", ["pending_moderation", "live", "hidden", "rejected"]);

    if (updateError) {
      log.error("Failed to moderate promotion", { error: updateError.message });
      return NextResponse.json({ error: "Failed to moderate promotion" }, { status: 500 });
    }

    // Audit
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: adminRole,
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
    return internalApiError("Failed to moderate promotion");
  }
}
