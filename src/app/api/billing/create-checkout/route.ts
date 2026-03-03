import { NextResponse, type NextRequest } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPayFastCheckoutUrl } from "@/lib/services/payfast";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { z } from "zod";

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
 * Create a PayFast checkout session and return the redirect URL.
 * Requires authenticated user with a seller profile.
 */
export async function POST(request: NextRequest) {
  try {
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
    const rateCheck = await checkRateLimit({ key: ip, action: "billing:checkout" });
    if (rateCheck.limited) {
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

    // ── Get seller profile ───────────────────────────────────
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("seller_profiles")
      .select("id, display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });
    }

    // ── Fetch plan ───────────────────────────────────────────
    const { data: plan } = await admin
      .from("plans")
      .select("*")
      .eq("id", planId)
      .eq("active", true)
      .maybeSingle();

    if (!plan) {
      return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });
    }

    // ── Prevent Duplicate Active Entitlements ─────────────
    const { data: activeEntitlement } = await admin
      .from("entitlements")
      .select("id")
      .eq("user_id", user.id)
      .eq("area", plan.area)
      .eq("type", "subscription")
      .eq("status", "active")
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

    // ── Create pending payment record ────────────────────────
    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        area: plan.area,
        amount_cents: plan.price_cents,
        status: "pending",
        payfast_data: {
          type: "subscription",
          plan_id: plan.id,
          plan_tier: plan.tier,
          area: plan.area,
        },
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      log.error("Failed to create payment", { error: paymentError });
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    // ── Build PayFast checkout URL ───────────────────────────
    const merchantId = env("PAYFAST_MERCHANT_ID");
    const merchantKey = env("PAYFAST_MERCHANT_KEY");
    if (!merchantId || !merchantKey) {
      log.error("PayFast credentials not configured");
      return NextResponse.json(
        { error: "Billing is not yet configured. Please try again later." },
        { status: 503 }
      );
    }

    const amountRands = plan.price_cents / 100;
    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.co.za";
    const notifyUrl = env("PAYFAST_NOTIFY_URL") || `${appUrl}/api/webhooks/payfast`;

    const checkoutUrl = buildPayFastCheckoutUrl({
      merchantId,
      merchantKey,
      returnUrl: `${appUrl}/billing/success?payment=${payment.id}`,
      cancelUrl: `${appUrl}/billing/cancel`,
      notifyUrl,
      paymentId: payment.id,
      amount: amountRands,
      itemName: plan.name,
      itemDescription: `${plan.name} — 30-day subscription`,
      emailAddress: user.email || undefined,
    });

    // ── Audit log ────────────────────────────────────────────
    await logAuditEvent({
      actorId: user.id,
      actorRole: "seller",
      action: "checkout_initiated",
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        planId: plan.id,
        planName: plan.name,
        amount: amountRands,
        status: "checkout_initiated",
      },
    });

    return NextResponse.json({
      success: true,
      checkoutUrl,
      paymentId: payment.id,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
