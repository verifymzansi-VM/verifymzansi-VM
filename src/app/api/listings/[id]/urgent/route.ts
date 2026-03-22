import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUrgent } from "@/lib/services/entitlements";
import { logAuditEvent } from "@/lib/services/audit";
import { ADDON_PRICES, URGENT_DURATION_DAYS } from "@/lib/constants/pricing";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { createHostedCheckout } from "@/lib/payments/checkout";
import { getActivePlanTierForArea } from "@/lib/services/plan-tier";
import {
  ACCOUNT_PROFILE_NOT_FOUND_ERROR,
  applyOwnerFilter,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import type { MarketplaceArea } from "@/types/enums";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { parseAndValidateRouteParams } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";
import { z } from "zod";

const log = createLogger("UrgentCheckout");
const listingUrgentParamsSchema = z.object({
  id: uuidSchema,
});
type ListingCheckoutRow = {
  id: string;
  title: string;
  status: string;
  area?: MarketplaceArea | null;
  urgent_until?: string | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

/**
 * POST /api/listings/[id]/urgent
 *
 * Create an Ozow checkout session to mark a listing as urgent.
 * Requires authenticated user who owns the listing, on Pro plan.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const originBlock = enforceSameOriginMutation(_request, log);
    if (originBlock) return originBlock;

    const parsedParams = parseAndValidateRouteParams(await params, listingUrgentParamsSchema, {
      validationErrorMessage: "Invalid listing ID",
      includeValidationDetails: false,
    });
    if (!parsedParams.success) {
      return parsedParams.response;
    }
    const { id: listingId } = parsedParams.data;

    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "listing:urgent");
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
        .select(withOwnerColumn("id, title, status, area, owner_id, urgent_until", ownerColumn))
        .eq("id", listingId),
      ownerColumn,
      user.id
    ).maybeSingle();
    const listing = rawListing as ListingCheckoutRow | null;

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    if (readOwnerId(listing) !== user.id) {
      return NextResponse.json(
        { error: "Forbidden — you do not own this listing" },
        { status: 403 }
      );
    }

    if (listing.status !== "live") {
      return NextResponse.json(
        { error: "Only live listings can be marked urgent" },
        { status: 400 }
      );
    }

    // ── Check if already urgent ──────────────────────────────
    if (listing.urgent_until && new Date(listing.urgent_until) > new Date()) {
      return NextResponse.json({ error: "This listing is already marked urgent" }, { status: 400 });
    }

    // ── Prevent duplicate in-flight payments ─────────────────
    const { data: pendingPmt } = await admin
      .from("payments")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"])
      .contains("provider_data", { type: "urgent", listing_id: listingId })
      .maybeSingle();
    if (pendingPmt) {
      return NextResponse.json(
        { error: "An urgent payment is already in progress for this listing" },
        { status: 409 }
      );
    }

    // ── Check entitlement ────────────────────────────────────
    const area = (listing.area || "MZANSI_MARKET") as MarketplaceArea;
    const tier = await getActivePlanTierForArea(user.id, area);
    const urgentCheck = canUrgent(tier, area);

    if (!urgentCheck.allowed) {
      return NextResponse.json({ error: urgentCheck.reason }, { status: 403 });
    }

    const urgentDays = URGENT_DURATION_DAYS;
    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";
    const { paymentId, checkoutUrl } = await createHostedCheckout({
      admin: admin as never,
      userId: user.id,
      area,
      amountCents: ADDON_PRICES.urgent,
      itemName: `Urgent: ${listing.title}`.slice(0, 100),
      itemDescription: `${urgentDays}-day urgent listing`,
      returnUrl: `${appUrl}/billing/success?payment=__PAYMENT_ID__`,
      cancelUrl: `${appUrl}/billing/cancel?payment=__PAYMENT_ID__`,
      providerData: {
        type: "urgent",
        listing_id: listingId,
        urgent_days: urgentDays,
      },
    });

    // Audit is best-effort — never block checkout on audit failure
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_urgent",
        targetType: "listing",
        targetId: listingId,
        area: area as "MZANSI_MARKET" | "MALL_SHOPS" | "BUSINESS_ADS" | "PROMOTIONS_EVENTS",
        metadata: {
          paymentId,
          amount: ADDON_PRICES.urgent / 100,
          urgentDays,
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
    return NextResponse.json({ error: "Failed to create urgent checkout" }, { status: 500 });
  }
}
