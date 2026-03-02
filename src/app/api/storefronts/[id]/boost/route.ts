import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPayFastCheckoutUrl } from "@/lib/services/payfast";
import { canBoost } from "@/lib/services/entitlements";
import { logAuditEvent } from "@/lib/services/audit";
import { ADDON_PRICES, BOOST_DURATION_DAYS } from "@/lib/constants/pricing";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { getActivePlanTierForArea } from "@/lib/services/plan-tier";

const log = createLogger("BoostStorefront");

/**
 * POST /api/storefronts/[id]/boost
 *
 * Create a PayFast checkout session to boost a storefront.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: storefrontId } = await params;

    // Validate UUID format
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(storefrontId)) {
      return NextResponse.json({ error: "Invalid storefront ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: seller } = await admin
      .from("seller_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!seller) {
      return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });
    }

    const { data: storefront } = await admin
      .from("storefronts")
      .select("id, mall_name, status, seller_id, boost_until")
      .eq("id", storefrontId)
      .maybeSingle();

    if (!storefront) {
      return NextResponse.json({ error: "Storefront not found" }, { status: 404 });
    }

    if (storefront.seller_id !== user.id) {
      return NextResponse.json({ error: "You don't own this storefront" }, { status: 403 });
    }

    if (storefront.status !== "live") {
      return NextResponse.json({ error: "Only live storefronts can be boosted" }, { status: 400 });
    }

    if (storefront.boost_until && new Date(storefront.boost_until) > new Date()) {
      return NextResponse.json({ error: "This storefront is already boosted" }, { status: 400 });
    }

    const tier = await getActivePlanTierForArea(user.id, "MALL_SHOPS");
    const boostCheck = canBoost(tier, "MALL_SHOPS");

    if (!boostCheck.allowed) {
      return NextResponse.json({ error: boostCheck.reason }, { status: 403 });
    }

    const amountRands = ADDON_PRICES.boost / 100;

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        area: "MALL_SHOPS",
        amount_cents: ADDON_PRICES.boost,
        status: "pending",
        payfast_data: {
          type: "boost_storefront",
          storefront_id: storefrontId,
          boost_days: BOOST_DURATION_DAYS,
        },
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      log.error("Failed to create payment", { error: paymentError });
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.co.za";
    const notifyUrl = env("PAYFAST_NOTIFY_URL") || `${appUrl}/api/webhooks/payfast`;

    const merchantId = env("PAYFAST_MERCHANT_ID");
    const merchantKey = env("PAYFAST_MERCHANT_KEY");
    if (!merchantId || !merchantKey) {
      return NextResponse.json(
        { error: "Billing is not yet configured. Please try again later." },
        { status: 503 }
      );
    }

    const checkoutUrl = buildPayFastCheckoutUrl({
      merchantId,
      merchantKey,
      returnUrl: `${appUrl}/dashboard/storefronts?boosted=${storefrontId}`,
      cancelUrl: `${appUrl}/dashboard/storefronts`,
      notifyUrl,
      paymentId: payment.id,
      amount: amountRands,
      itemName: `Boost: ${storefront.mall_name}`.slice(0, 100),
      itemDescription: `${BOOST_DURATION_DAYS}-day storefront boost`,
      emailAddress: user.email || undefined,
    });

    // Audit is best-effort — never block checkout on audit failure
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "seller",
        action: "storefront_boosted",
        targetType: "storefront",
        targetId: storefrontId,
        area: "MALL_SHOPS",
        metadata: {
          paymentId: payment.id,
          amount: amountRands,
          boostDays: BOOST_DURATION_DAYS,
          status: "checkout_initiated",
        },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
        paymentId: payment.id,
      });
    }

    return NextResponse.json({ success: true, checkoutUrl, paymentId: payment.id });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to create boost checkout" }, { status: 500 });
  }
}
