import { NextResponse, type NextRequest } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createHostedCheckout } from "@/lib/payments/checkout";
import {
  OzowAuthenticationError,
  OzowConfigurationError,
  OzowProviderError,
} from "@/lib/payments/ozow";
import { z } from "zod";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { resolveBillingPlanSelection } from "@/lib/billing/plan-resolver";
import { resolveSafeBillingAppUrl } from "@/lib/billing/app-url";

const log = createLogger("Checkout");

const checkoutSchema = z.object({
  planId: z.string().uuid("Invalid plan ID"),
  area: z
    .enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "BUSINESS_ADS", "MALL_SHOPS", "PROMOTIONS_EVENTS"])
    .optional(),
});

/**
 * POST /api/billing/create-checkout
 *
 * Create a payment checkout session and return the redirect URL.
 * Requires an authenticated user with an account profile.
 */
export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.email_confirmed_at) {
      return NextResponse.json(
        { error: "Please confirm your email address before making purchases." },
        { status: 403 }
      );
    }

    // ── Rate limit ──────────────────────────────────────────
    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: `${user.id}:${ip}`,
      action: "billing:checkout",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          { error: "Checkout protection is temporarily unavailable. Please try again shortly." },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

      return NextResponse.json(
        { error: "Too many checkout attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    // ── Validate input ───────────────────────────────────────
    const parsed = await parseAndValidateJsonRequest(request, checkoutSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid checkout request",
      includeValidationDetails: false,
    });
    if (!parsed.success) {
      return parsed.response;
    }

    const { planId } = parsed.data;

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
      .select("id")
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

    if (pendingPayment) {
      return NextResponse.json(
        {
          error:
            "You already have a pending payment for this area. Please wait for it to complete or cancel it.",
        },
        { status: 409 }
      );
    }

    const appUrlResult = resolveSafeBillingAppUrl(log);
    if (appUrlResult.response) return appUrlResult.response;
    const appUrl = appUrlResult.appUrl;

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
        return NextResponse.json(
          {
            error:
              "You already have a pending payment for this area. Please wait for it to complete or cancel it.",
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
