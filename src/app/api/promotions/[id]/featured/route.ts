import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canFeatured } from "@/lib/services/entitlements";
import { logAuditEvent } from "@/lib/services/audit";
import { ADDON_PRICES, FEATURED_DURATION_DAYS } from "@/lib/constants/pricing";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { createHostedCheckout } from "@/lib/payments/checkout";
import { getActivePlanTierForArea } from "@/lib/services/plan-tier";
import {
  ACCOUNT_PROFILE_NOT_FOUND_ERROR,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import type { MarketplaceArea } from "@/types/enums";

const log = createLogger("PromotionFeaturedCheckout");
type PromotionCheckoutRow = {
  id: string;
  title: string;
  status: string;
  featured_until?: string | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

/**
 * POST /api/promotions/[id]/featured
 *
 * Create an Ozow checkout session to feature a standalone promotion.
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
    const ownerColumn = await getOwnerColumn(admin, "promotions");

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
    const { data: rawPromotion } = await admin
      .from("promotions")
      .select(withOwnerColumn("id, title, status, owner_id, featured_until", ownerColumn))
      .eq("id", promotionId)
      .maybeSingle();
    const promotion = rawPromotion as PromotionCheckoutRow | null;

    if (!promotion) {
      return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
    }

    if (readOwnerId(promotion) !== user.id) {
      return NextResponse.json({ error: "You don't own this promotion" }, { status: 403 });
    }

    if (promotion.status !== "live") {
      return NextResponse.json({ error: "Only live promotions can be featured" }, { status: 400 });
    }

    // Check if already featured
    if (promotion.featured_until && new Date(promotion.featured_until) > new Date()) {
      return NextResponse.json({ error: "This promotion is already featured" }, { status: 400 });
    }

    // Check entitlement — requires Growth or Pro plan
    const area = "PROMOTIONS_EVENTS" as MarketplaceArea;
    const tier = await getActivePlanTierForArea(user.id, area);
    const featuredCheck = canFeatured(tier, area);

    if (!featuredCheck.allowed) {
      return NextResponse.json({ error: featuredCheck.reason }, { status: 403 });
    }

    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";
    const { paymentId, checkoutUrl } = await createHostedCheckout({
      admin: admin as never,
      userId: user.id,
      area: "MZANSI_MARKET",
      amountCents: ADDON_PRICES.featured,
      itemName: `Featured: ${promotion.title}`.slice(0, 100),
      itemDescription: `${FEATURED_DURATION_DAYS}-day promotion feature`,
      returnUrl: `${appUrl}/billing/success?payment=__PAYMENT_ID__`,
      cancelUrl: `${appUrl}/billing/cancel?payment=__PAYMENT_ID__`,
      providerData: {
        type: "featured_promotion",
        promotion_id: promotionId,
        feature_days: FEATURED_DURATION_DAYS,
      },
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
          paymentId,
          amount: ADDON_PRICES.featured / 100,
          featureDays: FEATURED_DURATION_DAYS,
          status: "checkout_initiated",
        },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
        paymentId,
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
    });
    return NextResponse.json({ error: "Failed to create featured checkout" }, { status: 500 });
  }
}
