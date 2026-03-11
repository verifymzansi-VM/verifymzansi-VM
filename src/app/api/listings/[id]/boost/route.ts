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
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR } from "@/lib/account/compat";
import type { MarketplaceArea } from "@/types/enums";

const log = createLogger("BoostCheckout");

/**
 * POST /api/listings/[id]/boost
 *
 * Create a PayFast checkout session to boost a listing.
 * Requires authenticated user who owns the listing, on Growth or Pro plan.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: listingId } = await params;

    // Validate UUID format to avoid unnecessary DB queries
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(listingId)) {
      return NextResponse.json({ error: "Invalid listing ID" }, { status: 400 });
    }

    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    // ── Get account profile ──────────────────────────────────
    const { data: profile } = await admin
      .from("account_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    // ── Check listing exists and belongs to user ─────────────
    const { data: listing } = await admin
      .from("listings")
      .select("id, title, status, area, owner_id, boost_until")
      .eq("id", listingId)
      .maybeSingle();

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (listing.owner_id !== user.id) {
      return NextResponse.json({ error: "You don't own this listing" }, { status: 403 });
    }

    if (listing.status !== "live") {
      return NextResponse.json({ error: "Only live listings can be boosted" }, { status: 400 });
    }

    // ── Check if already boosted ─────────────────────────────
    if (listing.boost_until && new Date(listing.boost_until) > new Date()) {
      return NextResponse.json({ error: "This listing is already boosted" }, { status: 400 });
    }

    // ── Check entitlement ────────────────────────────────────
    const area = (listing.area || "MZANSI_MARKET") as MarketplaceArea;
    const tier = await getActivePlanTierForArea(user.id, area);
    const boostCheck = canBoost(tier, area);

    if (!boostCheck.allowed) {
      return NextResponse.json({ error: boostCheck.reason }, { status: 403 });
    }

    // ── Create pending payment record ────────────────────────
    const amountRands = ADDON_PRICES.boost / 100;

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        area: area,
        amount_cents: ADDON_PRICES.boost,
        status: "pending",
        payfast_data: {
          type: "boost",
          listing_id: listingId,
          boost_days: BOOST_DURATION_DAYS,
        },
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      log.error("Failed to create payment", { error: paymentError });
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    // ── Build PayFast checkout URL ───────────────────────────
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
      returnUrl: `${appUrl}/dashboard/listings?boosted=${listingId}`,
      cancelUrl: `${appUrl}/dashboard/listings`,
      notifyUrl,
      paymentId: payment.id,
      amount: amountRands,
      itemName: `Boost: ${listing.title}`.slice(0, 100),
      itemDescription: `${BOOST_DURATION_DAYS}-day listing boost`,
      emailAddress: user.email || undefined,
    });

    // ── Audit log (best-effort — never block checkout) ────────
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_boosted",
        targetType: "listing",
        targetId: listingId,
        area: area as "MZANSI_MARKET" | "MALL_SHOPS" | "BUSINESS_ADS" | "PROMOTIONS_EVENTS",
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

    return NextResponse.json({
      success: true,
      checkoutUrl,
      paymentId: payment.id,
    });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Failed to create boost checkout" }, { status: 500 });
  }
}
