import { NextResponse, type NextRequest } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { createHostedCheckout } from "@/lib/payments/checkout";
import {
  OzowAuthenticationError,
  OzowConfigurationError,
  OzowProviderError,
} from "@/lib/payments/ozow";
import { z } from "zod";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { resolveBillingPlanSelection } from "@/lib/billing/plan-resolver";
import { resolveSafeBillingAppUrl } from "@/lib/billing/app-url";
import { enforceBillingMutationGuard } from "@/lib/billing/route-guard";

const log = createLogger("Checkout");

const checkoutSchema = z.object({
  planId: z.string().uuid("Invalid plan ID"),
  area: z.enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"]).optional(),
});

function getCheckoutUrl(providerData: unknown): string | null {
  if (!providerData || typeof providerData !== "object" || Array.isArray(providerData)) {
    return null;
  }

  const checkoutUrl = (providerData as Record<string, unknown>).checkout_url;
  return typeof checkoutUrl === "string" && checkoutUrl.startsWith("https://") ? checkoutUrl : null;
}

function buildPendingPaymentResponse({
  appUrl,
  pendingPayment,
}: {
  appUrl: string;
  pendingPayment: { id: string; status?: string; provider_data?: unknown };
}) {
  return NextResponse.json(
    {
      error:
        "You already have a pending payment for this area. Continue the payment or cancel it before choosing another plan.",
      code: "PENDING_PAYMENT_EXISTS",
      pendingPayment: {
        id: pendingPayment.id,
        checkoutUrl: getCheckoutUrl(pendingPayment.provider_data),
        statusUrl: `${appUrl}/billing/success?payment=${pendingPayment.id}`,
        canCancel: pendingPayment.status === "pending",
      },
    },
    { status: 409 }
  );
}

/**
 * POST /api/billing/create-checkout
 *
 * Create a payment checkout session and return the redirect URL.
 * Requires an authenticated user with an account profile.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await enforceBillingMutationGuard({
      request,
      log,
      rateLimitAction: "billing:checkout",
      rateLimitKey: (userId, ip) => `${userId}:${ip}`,
      requireConfirmedEmailMessage: "Please confirm your email address before making purchases.",
      degradedMessage: "Checkout protection is temporarily unavailable. Please try again shortly.",
      limitedMessage: "Too many checkout attempts. Please try again later.",
    });
    if (!guard.success) return guard.response;
    const { supabase, user } = guard;

    // ── Validate input ───────────────────────────────────────
    const parsed = await parseAndValidateJsonRequest(request, checkoutSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid checkout request",
      includeValidationDetails: false,
    });
    if (!parsed.success) {
      return parsed.response;
    }

    const { planId, area } = parsed.data;

    let admin: ReturnType<typeof createAdminClient> | null = null;
    const getAdmin = () => {
      admin ??= createAdminClient();
      return admin;
    };

    // ── Get account profile ──────────────────────────────────
    const { data: profile, error: profileError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id, display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      log.error("Failed to fetch account profile", {
        userId: user.id,
        error: profileError.message,
      });
      return NextResponse.json({ error: "Unable to verify account" }, { status: 500 });
    }

    if (!profile) {
      return NextResponse.json({ error: "Account profile not found" }, { status: 404 });
    }

    // ── Fetch plan ───────────────────────────────────────────
    const { plan, error: planError } = await resolveBillingPlanSelection(
      supabase as never,
      planId,
      { requireActive: true }
    );

    if (planError) {
      log.error("Failed to load checkout plan", {
        planId,
        userId: user.id,
        error: planError.message,
        code: planError.code,
      });
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }

    if (!plan) {
      return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });
    }

    // Clients may echo the area they believe the plan belongs to — reject
    // mismatches instead of silently checking out a different area.
    if (area && area !== plan.area) {
      return NextResponse.json(
        { error: "Selected plan does not belong to the requested area" },
        { status: 400 }
      );
    }

    // ── Prevent Duplicate Active Entitlements ─────────────
    const { data: activeEntitlement, error: entitlementError } = await getAdmin()
      .from("entitlements")
      .select("id")
      .eq("user_id", user.id)
      .eq("area", plan.area)
      .eq("type", "subscription")
      .in("status", ["active", "pending_verification"])
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (entitlementError) {
      log.error("Failed to check active entitlements", {
        userId: user.id,
        error: entitlementError.message,
      });
      return NextResponse.json({ error: "Unable to verify subscription status" }, { status: 503 });
    }

    if (activeEntitlement) {
      return NextResponse.json(
        {
          error:
            "You already have an active subscription for this area. Please cancel it before switching plans.",
        },
        { status: 400 }
      );
    }

    // ── Prevent duplicate in-flight payments ─────────────
    const { data: pendingPayment, error: pendingError } = await getAdmin()
      .from("payments")
      .select("id, status, provider_data")
      .eq("user_id", user.id)
      .eq("area", plan.area)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingError) {
      log.error("Failed to check pending payments", {
        userId: user.id,
        error: pendingError.message,
      });
      return NextResponse.json({ error: "Unable to verify payment status" }, { status: 503 });
    }

    const appUrlResult = resolveSafeBillingAppUrl(log);
    if (appUrlResult.response) return appUrlResult.response;
    const appUrl = appUrlResult.appUrl;

    if (pendingPayment) {
      return buildPendingPaymentResponse({
        appUrl,
        pendingPayment: pendingPayment as { id: string; status?: string; provider_data?: unknown },
      });
    }

    let paymentId: string;
    let checkoutUrl: string;
    try {
      const checkout = await createHostedCheckout({
        admin: getAdmin() as never,
        userId: user.id,
        area: plan.area,
        amountCents: plan.price_cents,
        itemName: plan.name,
        itemDescription: `${plan.name} - 30-day subscription`,
        returnUrl: `${appUrl}/billing/success?payment=__PAYMENT_ID__`,
        cancelUrl: `${appUrl}/billing/cancel?payment=__PAYMENT_ID__`,
        providerData: {
          type: "subscription",
          plan_id: plan.id,
          plan_tier: plan.tier,
          area: plan.area,
        },
      });
      paymentId = checkout.paymentId;
      checkoutUrl = checkout.checkoutUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create checkout session";

      // Race-condition duplicate caught by DB unique index
      if (message === "A checkout for this area is already in progress") {
        const { data: racePendingPayment } = await getAdmin()
          .from("payments")
          .select("id, status, provider_data")
          .eq("user_id", user.id)
          .eq("area", plan.area)
          .in("status", ["pending", "processing"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (racePendingPayment) {
          return buildPendingPaymentResponse({
            appUrl,
            pendingPayment: racePendingPayment as {
              id: string;
              status?: string;
              provider_data?: unknown;
            },
          });
        }

        return NextResponse.json(
          {
            error:
              "You already have a pending payment for this area. Please wait a moment, then try again.",
            code: "PENDING_PAYMENT_EXISTS",
          },
          { status: 409 }
        );
      }

      const errorCode =
        error instanceof OzowConfigurationError
          ? error.code
          : error instanceof OzowAuthenticationError
            ? error.code
            : error instanceof OzowProviderError
              ? error.code
              : undefined;
      log.error("Failed to create hosted checkout", {
        error: message,
        errorCode,
        planId,
        userId: user.id,
      });
      if (error instanceof OzowConfigurationError) {
        return NextResponse.json(
          { error: "Payment processing is not yet configured. Please try again later." },
          { status: 503 }
        );
      }
      if (error instanceof OzowAuthenticationError) {
        return NextResponse.json(
          {
            error:
              "Payment provider account is not authorized for this Ozow site. Please contact support.",
          },
          { status: 503 }
        );
      }
      if (error instanceof OzowProviderError) {
        return NextResponse.json(
          {
            error:
              "Payment provider is temporarily unavailable. Please try again in a few minutes.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }

    // ── Audit log (best-effort) ────────────────────────────────
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "checkout_initiated",
        targetType: "payment",
        targetId: paymentId,
        metadata: {
          planId: plan.id,
          planName: plan.name,
          amount: plan.price_cents / 100,
          status: "checkout_initiated",
        },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

    return NextResponse.json({
      success: true,
      checkoutUrl,
      paymentId,
    });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
