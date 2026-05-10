import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { logAuditEvent } from "@/lib/services/audit";
import { createNotification } from "@/lib/notifications";
import { enforceBillingMutationGuard } from "@/lib/billing/route-guard";

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
    const guard = await enforceBillingMutationGuard({
      request,
      log,
      rateLimitAction: "billing:cancel",
      degradedMessage:
        "Subscription cancellation is temporarily unavailable. Please try again shortly.",
      limitedMessage: "Too many cancellation attempts. Please try again later.",
    });
    if (!guard.success) return guard.response;
    const { user } = guard;

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

    const { data: cancelledRows, error: cancelError } = await admin
      .from("entitlements")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", entitlement.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .select("id");

    if (cancelError) {
      log.error("Failed to cancel entitlement", {
        userId: user.id,
        entitlementId,
        error: cancelError.message,
      });
      return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 });
    }
    if (!cancelledRows || cancelledRows.length === 0) {
      return NextResponse.json(
        { error: "Subscription status changed before cancellation completed" },
        { status: 409 }
      );
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
