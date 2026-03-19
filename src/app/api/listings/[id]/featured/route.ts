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
  applyOwnerFilter,
  getOwnerColumn,
  withOwnerColumn,
} from "@/lib/account/compat";
import type { MarketplaceArea } from "@/types/enums";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";

const log = createLogger("FeaturedCheckout");
type ListingCheckoutRow = {
  id: string;
  title: string;
  status: string;
  area?: MarketplaceArea | null;
  featured_until?: string | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

/**
 * POST /api/listings/[id]/featured
 *
 * Create an Ozow checkout session to feature a listing.
 * Requires authenticated user who owns the listing, on Pro plan.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const originBlock = enforceSameOriginMutation(_request, log);
    if (originBlock) return originBlock;

    const { id: listingId } = await params;

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

    const rl = checkLocalRateLimit(user.id, "listing:featured");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(supabase, "listings");

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
    const { data: rawListing } = await applyOwnerFilter(
      supabase
        .from("listings")
        .select(withOwnerColumn("id, title, status, area, owner_id, featured_until", ownerColumn))
        .eq("id", listingId),
      ownerColumn,
      user.id
    ).maybeSingle();
    const listing = rawListing as ListingCheckoutRow | null;

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (listing.status !== "live") {
      return NextResponse.json({ error: "Only live listings can be featured" }, { status: 400 });
    }

    // ── Check if already featured ────────────────────────────
    if (listing.featured_until && new Date(listing.featured_until) > new Date()) {
      return NextResponse.json({ error: "This listing is already featured" }, { status: 400 });
    }

    // ── Check entitlement ────────────────────────────────────
    const area = (listing.area || "MZANSI_MARKET") as MarketplaceArea;
    const tier = await getActivePlanTierForArea(user.id, area);
    const featuredCheck = canFeatured(tier, area);

    if (!featuredCheck.allowed) {
      return NextResponse.json({ error: featuredCheck.reason }, { status: 403 });
    }

    const featureDays = FEATURED_DURATION_DAYS;
    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";
    const { paymentId, checkoutUrl } = await createHostedCheckout({
      admin: admin as never,
      userId: user.id,
      area,
      amountCents: ADDON_PRICES.featured,
      itemName: `Featured: ${listing.title}`.slice(0, 100),
      itemDescription: `${featureDays}-day featured listing`,
      returnUrl: `${appUrl}/billing/success?payment=__PAYMENT_ID__`,
      cancelUrl: `${appUrl}/billing/cancel?payment=__PAYMENT_ID__`,
      providerData: {
        type: "featured",
        listing_id: listingId,
        feature_days: featureDays,
      },
    });

    // Audit is best-effort — never block checkout on audit failure
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_featured",
        targetType: "listing",
        targetId: listingId,
        area: area as "MZANSI_MARKET" | "MALL_SHOPS" | "BUSINESS_ADS" | "PROMOTIONS_EVENTS",
        metadata: {
          paymentId,
          amount: ADDON_PRICES.featured / 100,
          featureDays,
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
