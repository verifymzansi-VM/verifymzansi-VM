import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ACCOUNT_PROFILE_NOT_FOUND_ERROR,
  applyOwnerFilter,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { uuidSchema } from "@/lib/validations/shared";
import type { MarketplaceArea, PlanTier } from "@/types/enums";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

const promotionAddonParamsSchema = z.object({
  id: uuidSchema,
});

type PromotionCheckoutRow = {
  id: string;
  title: string;
  status: string;
  owner_id?: string | null;
  seller_id?: string | null;
} & Record<string, string | null | undefined>;

type AllowedResult = {
  allowed: boolean;
  reason?: string;
};

type PromotionAddonRouteConfig = {
  loggerName: string;
  validationErrorMessage: string;
  rateLimitAction: string;
  limitedErrorMessage: string;
  degradedErrorMessage: string;
  activeUntilField: "featured_until" | "boost_until" | "urgent_until";
  activeVerb: string;
  alreadyActiveMessage: string;
  pendingPaymentMessage: string;
  paymentType: "featured_promotion" | "boost_promotion" | "urgent_promotion";
  paymentDurationKey: "feature_days" | "boost_days" | "urgent_days";
  durationDays: number;
  itemNamePrefix: string;
  itemDescription: string;
  amountCents: number;
  auditAction: "promotion_featured" | "promotion_boosted" | "promotion_urgent";
  auditDurationKey: "featureDays" | "boostDays" | "urgentDays";
  failureMessage: string;
  entitlementCheck: (tier: PlanTier, area: MarketplaceArea) => AllowedResult;
  requireOwnerMatch?: boolean;
  includeAuditArea?: boolean;
};

export function createPromotionAddonCheckoutRoute(config: PromotionAddonRouteConfig) {
  return createAddonCheckoutRouteCore({
    loggerName: config.loggerName,
    paramsSchema: promotionAddonParamsSchema,
    validationErrorMessage: config.validationErrorMessage,
    activeUntilField: config.activeUntilField,
    activeVerb: config.activeVerb,
    alreadyActiveMessage: config.alreadyActiveMessage,
    pendingPaymentMessage: config.pendingPaymentMessage,
    paymentType: config.paymentType,
    durationDays: config.durationDays,
    itemDescription: config.itemDescription,
    amountCents: config.amountCents,
    liveOnlyNoun: "promotions",
    auditAction: config.auditAction,
    auditDurationKey: config.auditDurationKey,
    failureMessage: config.failureMessage,
    getEntityId: ({ id }) => id,
    enforceRateLimit: async ({ request }) => {
      const rateCheck = await checkRateLimit({
        key: getClientIp(request),
        action: config.rateLimitAction,
        degradedMode: "block",
      });

      if (!rateCheck.limited) return null;

      if (rateCheck.degraded) {
        return NextResponse.json(
          { error: config.degradedErrorMessage },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

      return NextResponse.json(
        { error: config.limitedErrorMessage },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    },
    ensureAccountProfile: async ({ admin, user, log: routeLog }) => {
      const { data: profile, error: profileError } = await admin
        .from("account_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileError) {
        routeLog.error("Failed to fetch account profile", {
          userId: user.id,
          error: profileError.message,
        });
        return NextResponse.json({ error: "Unable to verify account" }, { status: 500 });
      }

      if (!profile) {
        return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
      }

      return null;
    },
    findEntity: async ({ params, supabase, user }) => {
      const ownerColumn = await getOwnerColumn(supabase, "promotions");
      const { data: rawPromotion } = await applyOwnerFilter(
        supabase
          .from("promotions")
          .select(
            withOwnerColumn(`id, title, status, owner_id, ${config.activeUntilField}`, ownerColumn)
          )
          .eq("id", params.id),
        ownerColumn,
        user.id
      ).maybeSingle();

      return rawPromotion as PromotionCheckoutRow | null;
    },
    getNotFoundMessage: "Promotion not found",
    verifyOwnership: (promotion, userId) => {
      if (!config.requireOwnerMatch || readOwnerId(promotion) === userId) {
        return null;
      }

      return NextResponse.json(
        { error: "Forbidden — you do not own this promotion" },
        { status: 403 }
      );
    },
    resolveArea: () => "PROMOTIONS_EVENTS" as MarketplaceArea,
    entitlementCheck: config.entitlementCheck,
    buildPendingPaymentMatch: (promotionId) => ({ promotion_id: promotionId }),
    buildCheckoutPayload: (promotion, promotionId) => ({
      area: "PROMOTIONS_EVENTS" as MarketplaceArea,
      itemName: `${config.itemNamePrefix}: ${promotion.title}`,
      providerData: {
        promotion_id: promotionId,
        [config.paymentDurationKey]: config.durationDays,
      },
    }),
    buildAuditPayload: (promotionId, area) => ({
      targetType: "promotion",
      targetId: promotionId,
      ...(config.includeAuditArea
        ? {
            area,
          }
        : {}),
    }),
  });
}
