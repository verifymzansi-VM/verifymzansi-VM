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
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR, ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

const log = createLogger("BoostBusiness");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/businesses/[id]/boost
 *
 * Create a PayFast checkout session to boost a business.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: businessId } = await params;

    if (!UUID_RE.test(businessId)) {
      return NextResponse.json({ error: "Invalid business ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: accountProfile } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!accountProfile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    const { data: business } = await admin
      .from("businesses")
      .select("id, business_name, status, seller_id, boost_until")
      .eq("id", businessId)
      .maybeSingle();

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    if (business.seller_id !== user.id) {
      return NextResponse.json({ error: "You don't own this business" }, { status: 403 });
    }

    if (business.status !== "live") {
      return NextResponse.json({ error: "Only live businesses can be boosted" }, { status: 400 });
    }

    if (business.boost_until && new Date(business.boost_until) > new Date()) {
      return NextResponse.json({ error: "This business is already boosted" }, { status: 400 });
    }

    const tier = await getActivePlanTierForArea(user.id, "MZANSI_BUSINESS");
    const boostCheck = canBoost(tier, "MZANSI_BUSINESS");

    if (!boostCheck.allowed) {
      return NextResponse.json({ error: boostCheck.reason }, { status: 403 });
    }

    const amountRands = ADDON_PRICES.boost / 100;

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        area: "MZANSI_BUSINESS",
        amount_cents: ADDON_PRICES.boost,
        status: "pending",
        payfast_data: {
          type: "boost_business",
          business_id: businessId,
          boost_days: BOOST_DURATION_DAYS,
        },
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      log.error("Failed to create payment", { error: paymentError });
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";
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
      returnUrl: `${appUrl}/dashboard/businesses?boosted=${businessId}`,
      cancelUrl: `${appUrl}/dashboard/businesses`,
      notifyUrl,
      paymentId: payment.id,
      amount: amountRands,
      itemName: `Boost: ${business.business_name}`.slice(0, 100),
      itemDescription: `${BOOST_DURATION_DAYS}-day business boost`,
      emailAddress: user.email || undefined,
    });

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "business_boosted",
        targetType: "business",
        targetId: businessId,
        area: "MZANSI_BUSINESS",
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
