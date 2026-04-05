import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canBoost } from "@/lib/services/entitlements";
import { logAuditEvent } from "@/lib/services/audit";
import { ADDON_PRICES, BOOST_DURATION_DAYS } from "@/lib/constants/pricing";
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
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { parseAndValidateRouteParams } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";
import { z } from "zod";

const log = createLogger("PromotionBoostCheckout");
const promotionBoostParamsSchema = z.object({
  id: uuidSchema,
});
type PromotionCheckoutRow = {
  id: string;
  title: string;
  status: string;
  boost_until?: string | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

/**
 * POST /api/promotions/[id]/boost
 *
 * Create an Ozow checkout session to boost a standalone promotion.
 * Requires authenticated user who owns the promotion.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const request = _request;
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const parsedParams = parseAndValidateRouteParams(await params, promotionBoostParamsSchema, {
      validationErrorMessage: "Invalid promotion ID",
      includeValidationDetails: false,
    });
    if (!parsedParams.success) {
      return parsedParams.response;
    }
    const { id: promotionId } = parsedParams.data;

    // Authenticate
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateCheck = await checkRateLimit({
      key: getClientIp(request),
      action: "promotion:boost",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          { error: "Promotion checkout protection is temporarily unavailable. Please try again." },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

      return NextResponse.json(
        { error: "Too many promotion boost attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(supabase, "promotions");

    // Check account profile
    const { data: profile, error: profileError } = await admin
      .from("account_profiles")
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

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    // Check promotion exists and belongs to user
    const { data: rawPromotion } = await applyOwnerFilter(
      supabase
        .from("promotions")
        .select(withOwnerColumn("id, title, status, owner_id, boost_until", ownerColumn))
        .eq("id", promotionId),
      ownerColumn,
      user.id
    ).maybeSingle();
    const promotion = rawPromotion as PromotionCheckoutRow | null;

    if (!promotion) {
      return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
    }

    if (promotion.status !== "live") {
      return NextResponse.json({ error: "Only live promotions can be boosted" }, { status: 400 });
    }

    // Check if already boosted
    if (promotion.boost_until && new Date(promotion.boost_until) > new Date()) {
      return NextResponse.json({ error: "This promotion is already boosted" }, { status: 400 });
    }

    // ── Prevent duplicate in-flight payments ─────────────────
    const { data: pendingPmt, error: pendingError } = await admin
      .from("payments")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"])
      .contains("provider_data", { type: "boost_promotion", promotion_id: promotionId })
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
        { error: "A boost payment is already in progress for this promotion" },
        { status: 409 }
      );
    }

    // Check entitlement — requires Growth or Pro plan
    const area = "PROMOTIONS_EVENTS" as MarketplaceArea;
    const tier = await getActivePlanTierForArea(user.id, area);
    const boostCheck = canBoost(tier, area);

    if (!boostCheck.allowed) {
      return NextResponse.json({ error: boostCheck.reason }, { status: 403 });
    }

    const appUrl = env("NEXT_PUBLIC_APP_URL") || "https://verifymzansi.com";
    const { paymentId, checkoutUrl } = await createHostedCheckout({
      admin: admin as never,
      userId: user.id,
      area,
      amountCents: ADDON_PRICES.boost,
      itemName: `Boost: ${promotion.title}`.slice(0, 100),
      itemDescription: `${BOOST_DURATION_DAYS}-day promotion boost`,
      returnUrl: `${appUrl}/billing/success?payment=__PAYMENT_ID__`,
      cancelUrl: `${appUrl}/billing/cancel?payment=__PAYMENT_ID__`,
      providerData: {
        type: "boost_promotion",
        promotion_id: promotionId,
        boost_days: BOOST_DURATION_DAYS,
      },
    });

    // Audit (best-effort)
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "promotion_boosted",
        targetType: "promotion",
        targetId: promotionId,
        metadata: {
          paymentId,
          amount: ADDON_PRICES.boost / 100,
          boostDays: BOOST_DURATION_DAYS,
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
    return NextResponse.json({ error: "Failed to create boost checkout" }, { status: 500 });
  }
}
