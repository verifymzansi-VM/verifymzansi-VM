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

const log = createLogger("BoostBusinessAd");

/**
 * POST /api/business-ads/[id]/boost
 *
 * Create a PayFast checkout session to boost a business profile.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: profileId } = await params;

    // Validate UUID format
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: "Invalid profile ID" }, { status: 400 });
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

    const { data: business } = await admin
      .from("business_profiles")
      .select("id, business_name, status, seller_id, boost_until")
      .eq("id", profileId)
      .maybeSingle();

    if (!business) {
      return NextResponse.json({ error: "Business profile not found" }, { status: 404 });
    }

    if (business.seller_id !== user.id) {
      return NextResponse.json({ error: "You don't own this profile" }, { status: 403 });
    }

    if (business.status !== "live") {
      return NextResponse.json({ error: "Only live profiles can be boosted" }, { status: 400 });
    }

    if (business.boost_until && new Date(business.boost_until) > new Date()) {
      return NextResponse.json({ error: "This profile is already boosted" }, { status: 400 });
    }

    const tier = await getActivePlanTierForArea(user.id, "BUSINESS_ADS");
    const boostCheck = canBoost(tier, "BUSINESS_ADS");

    if (!boostCheck.allowed) {
      return NextResponse.json({ error: boostCheck.reason }, { status: 403 });
    }

    const amountRands = ADDON_PRICES.boost / 100;

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        area: "BUSINESS_ADS",
        amount_cents: ADDON_PRICES.boost,
        status: "pending",
        payfast_data: {
          type: "boost_business",
          business_profile_id: profileId,
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
      returnUrl: `${appUrl}/dashboard/business-profiles?boosted=${profileId}`,
      cancelUrl: `${appUrl}/dashboard/business-profiles`,
      notifyUrl,
      paymentId: payment.id,
      amount: amountRands,
      itemName: `Boost: ${business.business_name}`.slice(0, 100),
      itemDescription: `${BOOST_DURATION_DAYS}-day business profile boost`,
      emailAddress: user.email || undefined,
    });

    // Audit is best-effort — never block checkout on audit failure
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "seller",
        action: "business_boosted",
        targetType: "business_profile",
        targetId: profileId,
        area: "BUSINESS_ADS",
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
