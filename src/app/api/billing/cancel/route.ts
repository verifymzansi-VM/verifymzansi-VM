import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { logAuditEvent } from "@/lib/services/audit";
import { createNotification } from "@/lib/notifications";

const log = createLogger("BillingCancel");

const cancelSchema = z.object({
  entitlementId: z.string().uuid("Invalid entitlement ID"),
});

/**
 * POST /api/billing/cancel
 * Cancel the caller's active subscription entitlement.
 */
export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "billing:cancel",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      const status = rateCheck.degraded ? 503 : 429;
      const error = rateCheck.degraded
        ? "Subscription cancellation is temporarily unavailable. Please try again shortly."
        : "Too many cancellation attempts. Please try again later.";
      return NextResponse.json(
        { error },
        { status, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const parsed = await parseAndValidateJsonRequest(request, cancelSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid cancellation request",
      includeValidationDetails: false,
    });
    if (!parsed.success) {
      return parsed.response;
    }

    const admin = createAdminClient();
    const { entitlementId } = parsed.data;

    const { data: entitlement, error: entitlementError } = await admin
      .from("entitlements")
      .select("id, user_id, area, tier, status, expires_at")
      .eq("id", entitlementId)
      .eq("user_id", user.id)
      .eq("type", "subscription")
      .maybeSingle();

    if (entitlementError) {
      log.error("Failed to fetch entitlement for cancellation", {
        userId: user.id,
        entitlementId,
        error: entitlementError.message,
      });
      return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 });
    }

    if (!entitlement) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    if (entitlement.status !== "active") {
      return NextResponse.json({ error: "Subscription is not active" }, { status: 409 });
    }

    const { error: cancelError } = await admin
      .from("entitlements")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", entitlement.id)
      .eq("user_id", user.id)
      .eq("status", "active");

    if (cancelError) {
      log.error("Failed to cancel entitlement", {
        userId: user.id,
        entitlementId,
        error: cancelError.message,
      });
      return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 });
    }

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "subscription_cancelled",
        targetType: "entitlement",
        targetId: entitlement.id,
        metadata: {
          area: entitlement.area,
          tier: entitlement.tier,
          expires_at: entitlement.expires_at,
        },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

    void createNotification({
      userId: user.id,
      type: "warning",
      title: "Subscription cancelled",
      message: "Your active subscription was cancelled. Your paid features are now disabled.",
      href: "/billing",
    }).catch((err: unknown) => log.warn("Cancel notification failed", { error: String(err) }));

    return NextResponse.json({ success: true, entitlementId: entitlement.id });
  } catch (error) {
    log.error("Unexpected cancellation error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 });
  }
}
