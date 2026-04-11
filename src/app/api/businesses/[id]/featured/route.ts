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
  ACCOUNT_PROFILE_WRITE_TABLE,
  applyOwnerFilter,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import type { MarketplaceArea } from "@/types/enums";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { parseAndValidateRouteParams } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";
import { z } from "zod";

const log = createLogger("FeaturedBusiness");
const businessFeaturedParamsSchema = z.object({
  id: uuidSchema,
});
type BusinessCheckoutRow = {
  id: string;
  business_name: string;
  status: string;
  area: string;
  featured_until?: string | null;
  owner_id?: string | null;
};

/**
 * POST /api/businesses/[id]/featured
 *
 * Create an Ozow checkout session to feature a business.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const originBlock = enforceSameOriginMutation(_request, log);
    if (originBlock) return originBlock;

    const csrfBlock = enforceCsrfToken(_request, log);
    if (csrfBlock) return csrfBlock;

    const parsedParams = parseAndValidateRouteParams(await params, businessFeaturedParamsSchema, {
      validationErrorMessage: "Invalid business ID",
      includeValidationDetails: false,
    });
    if (!parsedParams.success) {
      return parsedParams.response;
    }
    const { id: businessId } = parsedParams.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "business:featured");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(supabase, "businesses");

    const { data: accountProfile, error: profileError } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      log.error("Failed to fetch account profile", {
        userId: user.id,
        error: profileError.message,
      });
      return NextResponse.json({ error: "Unable to verify account" }, { status: 500 });
    }

    if (!accountProfile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    const { data: rawBusiness } = await applyOwnerFilter(
      supabase
        .from("businesses")
        .select(
          withOwnerColumn("id, business_name, status, area, owner_id, featured_until", ownerColumn)
        )
        .eq("id", businessId),
      ownerColumn,
      user.id
    ).maybeSingle();
    const business = rawBusiness as BusinessCheckoutRow | null;

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    if (readOwnerId(business) !== user.id) {
      return NextResponse.json(
        { error: "Forbidden — you do not own this business" },
        { status: 403 }
      );
    }

    if (business.status !== "live") {
      return NextResponse.json({ error: "Only live businesses can be featured" }, { status: 400 });
    }

    if (business.featured_until && new Date(business.featured_until) > new Date()) {
      return NextResponse.json({ error: "This business is already featured" }, { status: 400 });
    }

    // ── Prevent duplicate in-flight payments ─────────────────
    const { data: pendingPmt, error: pendingError } = await admin
      .from("payments")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"])
      .contains("provider_data", { type: "featured_business", business_id: businessId })
      .maybeSingle();

    if (pendingError) {
      log.error("Failed to check pending payments", {
        userId: user.id,
        error: pendingError.message,
      });
      return NextResponse.json({ error: "Unable to verify payment status" }, { status: 503 });
    }

    if (pendingPmt) {
      return NextResponse.json(
        { error: "A featured payment is already in progress for this business" },
        { status: 409 }
      );
    }

    const area = business.area as MarketplaceArea;
    const tier = await getActivePlanTierForArea(user.id, area);
    const featuredCheck = canFeatured(tier, area);

    if (!featuredCheck.allowed) {
      return NextResponse.json({ error: featuredCheck.reason }, { status: 403 });
    }

    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";
    const { paymentId, checkoutUrl } = await createHostedCheckout({
      admin: admin as never,
      userId: user.id,
      area,
      amountCents: ADDON_PRICES.featured,
      itemName: `Featured: ${business.business_name}`.slice(0, 100),
      itemDescription: `${FEATURED_DURATION_DAYS}-day business feature`,
      returnUrl: `${appUrl}/billing/success?payment=__PAYMENT_ID__`,
      cancelUrl: `${appUrl}/billing/cancel?payment=__PAYMENT_ID__`,
      providerData: {
        type: "featured_business",
        business_id: businessId,
        feature_days: FEATURED_DURATION_DAYS,
      },
    });

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "business_featured",
        targetType: "business",
        targetId: businessId,
        area,
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

    return NextResponse.json({ success: true, checkoutUrl, paymentId });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to create featured checkout" }, { status: 500 });
  }
}
