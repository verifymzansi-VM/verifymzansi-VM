import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPayFastCheckoutUrl } from "@/lib/services/payfast";
import { logAuditEvent } from "@/lib/services/audit";
import { ADDON_PRICES, FEATURED_DURATION_DAYS } from "@/lib/constants/pricing";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR } from "@/lib/account/compat";

const log = createLogger("PromotionFeaturedCheckout");

/**
 * POST /api/promotions/[id]/featured
 *
 * Create a PayFast checkout session to feature a standalone promotion.
 * Requires authenticated user who owns the promotion.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: promotionId } = await params;

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(promotionId)) {
      return NextResponse.json({ error: "Invalid promotion ID" }, { status: 400 });
    }

    // Authenticate
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Check account profile
    const { data: profile } = await admin
      .from("account_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    // Check promotion exists and belongs to user
    const { data: promotion } = await admin
      .from("promotions")
      .select("id, title, status, owner_id, featured_until")
      .eq("id", promotionId)
      .maybeSingle();

    if (!promotion) {
      return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
    }

    if (promotion.owner_id !== user.id) {
      return NextResponse.json({ error: "You don't own this promotion" }, { status: 403 });
    }

    if (promotion.status !== "live") {
      return NextResponse.json({ error: "Only live promotions can be featured" }, { status: 400 });
    }

    // Check if already featured
    if (promotion.featured_until && new Date(promotion.featured_until) > new Date()) {
      return NextResponse.json({ error: "This promotion is already featured" }, { status: 400 });
    }

    // Create pending payment record
    const amountRands = ADDON_PRICES.featured / 100;

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        area: "MZANSI_MARKET",
        amount_cents: ADDON_PRICES.featured,
        status: "pending",
        payfast_data: {
          type: "featured_promotion",
          promotion_id: promotionId,
          feature_days: FEATURED_DURATION_DAYS,
        },
      })
      .select("id")
      .single();

    if (paymentError || !payment) {
      log.error("Failed to create payment", { error: paymentError });
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    // Build PayFast checkout URL
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
      returnUrl: `${appUrl}/dashboard/promotions?featured=${promotionId}`,
      cancelUrl: `${appUrl}/dashboard/promotions`,
      notifyUrl,
      paymentId: payment.id,
      amount: amountRands,
      itemName: `Featured: ${promotion.title}`.slice(0, 100),
      itemDescription: `${FEATURED_DURATION_DAYS}-day promotion feature`,
      emailAddress: user.email || undefined,
    });

    // Audit (best-effort)
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_featured",
        targetType: "promotion",
        targetId: promotionId,
        metadata: {
          paymentId: payment.id,
          amount: amountRands,
          featureDays: FEATURED_DURATION_DAYS,
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
    return NextResponse.json({ error: "Failed to create featured checkout" }, { status: 500 });
  }
}
