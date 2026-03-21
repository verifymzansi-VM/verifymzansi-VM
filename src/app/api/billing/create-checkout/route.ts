import { NextResponse, type NextRequest } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createHostedCheckout } from "@/lib/payments/checkout";
import { z } from "zod";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";

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

    // ── Rate limit ──────────────────────────────────────────
    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
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
    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const parsed = checkoutSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { planId } = parsed.data;

    let admin: ReturnType<typeof createAdminClient> | null = null;
    const getAdmin = () => {
      admin ??= createAdminClient();
      return admin;
    };

    // ── Get account profile ──────────────────────────────────
    const { data: profile } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id, display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "Account profile not found" }, { status: 404 });
    }

    // ── Fetch plan ───────────────────────────────────────────
    const { data: plan } = await supabase
      .from("plans")
      .select("*")
      .eq("id", planId)
      .eq("active", true)
      .maybeSingle();

    if (!plan) {
      return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });
    }

    // ── Prevent Duplicate Active Entitlements ─────────────
    const { data: activeEntitlement } = await supabase
      .from("entitlements")
      .select("id")
      .eq("user_id", user.id)
      .eq("area", plan.area)
      .eq("type", "subscription")
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

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
    const { data: pendingPayment } = await supabase
      .from("payments")
      .select("id")
      .eq("user_id", user.id)
      .eq("area", plan.area)
      .in("status", ["pending", "processing"])
      .maybeSingle();

    if (pendingPayment) {
      return NextResponse.json(
        {
          error:
            "You already have a pending payment for this area. Please wait for it to complete or cancel it.",
        },
        { status: 409 }
      );
    }

    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";

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
      log.error("Failed to create hosted checkout", { error: message });
      if (/configured|authenticate/i.test(message)) {
        return NextResponse.json(
          { error: "Billing is not yet configured. Please try again later." },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }

    // ── Audit log ────────────────────────────────────────────
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
