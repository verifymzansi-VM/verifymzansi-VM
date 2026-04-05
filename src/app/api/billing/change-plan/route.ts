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
import { createHostedCheckout } from "@/lib/payments/checkout";
import { env } from "@/lib/config/env";
import { resolveBillingPlanSelection } from "@/lib/billing/plan-resolver";

const log = createLogger("BillingChangePlan");

const changePlanSchema = z.object({
  currentEntitlementId: z.string().uuid("Invalid current entitlement ID"),
  newPlanId: z.string().uuid("Invalid new plan ID"),
});

/**
 * POST /api/billing/change-plan
 * Starts a new checkout for a different subscription plan.
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

    if (!user.email_confirmed_at) {
      return NextResponse.json(
        { error: "Please confirm your email address before changing plans." },
        { status: 403 }
      );
    }

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "billing:change-plan",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      const status = rateCheck.degraded ? 503 : 429;
      const error = rateCheck.degraded
        ? "Plan change is temporarily unavailable. Please try again shortly."
        : "Too many plan change attempts. Please try again later.";
      return NextResponse.json(
        { error },
        { status, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const parsed = await parseAndValidateJsonRequest(request, changePlanSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid plan change request",
      includeValidationDetails: false,
    });
    if (!parsed.success) {
      return parsed.response;
    }

    const { currentEntitlementId, newPlanId } = parsed.data;
    const admin = createAdminClient();

    const { data: entitlement, error: entitlementError } = await admin
      .from("entitlements")
      .select("id, user_id, area, tier, status")
      .eq("id", currentEntitlementId)
      .eq("user_id", user.id)
      .eq("type", "subscription")
      .maybeSingle();

    if (entitlementError) {
      log.error("Failed to fetch entitlement for plan change", {
        userId: user.id,
        currentEntitlementId,
        error: entitlementError.message,
      });
      return NextResponse.json({ error: "Failed to change subscription" }, { status: 500 });
    }

    if (!entitlement) {
      return NextResponse.json({ error: "Current subscription not found" }, { status: 404 });
    }

    if (entitlement.status !== "active" && entitlement.status !== "pending_verification") {
      return NextResponse.json(
        { error: "Current subscription must be active to change plans" },
        { status: 409 }
      );
    }

    const { plan: newPlan, error: planError } = await resolveBillingPlanSelection(
      admin as never,
      newPlanId,
      { requireActive: true }
    );

    if (planError) {
      log.error("Failed to load target plan", {
        userId: user.id,
        newPlanId,
        error: planError.message,
      });
      return NextResponse.json({ error: "Failed to change subscription" }, { status: 500 });
    }

    if (!newPlan) {
      return NextResponse.json({ error: "New plan not found or inactive" }, { status: 404 });
    }

    if (newPlan.area !== entitlement.area) {
      return NextResponse.json(
        { error: "Plan changes must stay within the same marketplace area" },
        { status: 400 }
      );
    }

    if (newPlan.tier === entitlement.tier) {
      return NextResponse.json({ error: "You are already on this plan tier" }, { status: 409 });
    }

    // Block downgrades — only upgrades are supported via self-service
    const TIER_RANK: Record<string, number> = { starter: 0, growth: 1, pro: 2 };
    const currentRank = TIER_RANK[entitlement.tier] ?? -1;
    const newRank = TIER_RANK[newPlan.tier] ?? -1;
    if (newRank < currentRank) {
      return NextResponse.json(
        { error: "Plan downgrades are not yet supported. Please contact support for assistance." },
        { status: 400 }
      );
    }

    const { data: pendingPayment, error: pendingError } = await admin
      .from("payments")
      .select("id")
      .eq("user_id", user.id)
      .eq("area", entitlement.area)
      .in("status", ["pending", "processing"])
      .maybeSingle();

    if (pendingError) {
      log.error("Failed to check pending payments", {
        userId: user.id,
        error: pendingError.message,
      });
      return NextResponse.json({ error: "Unable to verify payment status" }, { status: 503 });
    }

    if (pendingPayment) {
      return NextResponse.json(
        {
          error:
            "You already have a payment in progress for this area. Please wait for it to complete.",
        },
        { status: 409 }
      );
    }

    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";
    let checkoutUrl: string;
    let paymentId: string;

    try {
      const checkout = await createHostedCheckout({
        admin: admin as never,
        userId: user.id,
        area: newPlan.area,
        amountCents: newPlan.price_cents,
        itemName: newPlan.name,
        itemDescription: `${newPlan.name} - plan change`,
        returnUrl: `${appUrl}/billing/success?payment=__PAYMENT_ID__`,
        cancelUrl: `${appUrl}/billing/cancel?payment=__PAYMENT_ID__`,
        providerData: {
          type: "subscription",
          plan_id: newPlan.id,
          plan_tier: newPlan.tier,
          area: newPlan.area,
          previous_entitlement_id: entitlement.id,
          previous_plan_tier: entitlement.tier,
          is_plan_change: true,
        },
      });
      checkoutUrl = checkout.checkoutUrl;
      paymentId = checkout.paymentId;
    } catch (checkoutError) {
      log.error("Failed to create hosted checkout for plan change", {
        userId: user.id,
        newPlanId,
        error: checkoutError instanceof Error ? checkoutError.message : "Unknown error",
      });
      return NextResponse.json({ error: "Failed to start plan change checkout" }, { status: 500 });
    }

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "checkout_initiated",
        targetType: "payment",
        targetId: paymentId,
        metadata: {
          change_type: "plan_change",
          previous_entitlement_id: entitlement.id,
          previous_tier: entitlement.tier,
          new_plan_id: newPlan.id,
          new_tier: newPlan.tier,
          area: newPlan.area,
        },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

    return NextResponse.json({ success: true, paymentId, checkoutUrl });
  } catch (error) {
    log.error("Unexpected plan change error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Failed to change subscription" }, { status: 500 });
  }
}
