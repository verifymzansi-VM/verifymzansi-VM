import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ACCOUNT_PROFILE_WRITE_TABLE,
  applyOwnerFilter,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { uuidSchema } from "@/lib/validations/shared";
import type { MarketplaceArea, PlanTier } from "@/types/enums";
import {
  createAddonAccountProfileGuard,
  createAddonCheckoutRouteCore,
  createAddonLocalRateLimitEnforcer,
} from "@/app/api/_lib/create-addon-checkout-route-core";

const businessAddonParamsSchema = z.object({
  id: uuidSchema,
});

type BusinessCheckoutRow = {
  id: string;
  business_name: string;
  status: string;
  area: string;
  owner_id?: string | null;
} & Record<string, string | null | undefined>;

type AllowedResult = {
  allowed: boolean;
  reason?: string;
};

type BusinessAddonRouteConfig = {
  loggerName: string;
  validationErrorMessage: string;
  rateLimitKey: string;
  activeUntilField: "featured_until" | "boost_until" | "urgent_until";
  activeVerb: string;
  alreadyActiveMessage: string;
  pendingPaymentMessage: string;
  paymentType: "featured_business" | "boost_business" | "urgent_business";
  paymentDurationKey: "feature_days" | "boost_days" | "urgent_days";
  durationDays: number;
  itemNamePrefix: string;
  itemDescription: string;
  amountCents: number;
  auditAction: "business_featured" | "business_boosted" | "business_urgent";
  auditDurationKey: "featureDays" | "boostDays" | "urgentDays";
  failureMessage: string;
  entitlementCheck: (tier: PlanTier, area: MarketplaceArea) => AllowedResult;
};

export function createBusinessAddonCheckoutRoute(config: BusinessAddonRouteConfig) {
  return createAddonCheckoutRouteCore({
    loggerName: config.loggerName,
    paramsSchema: businessAddonParamsSchema,
    validationErrorMessage: config.validationErrorMessage,
    activeUntilField: config.activeUntilField,
    activeVerb: config.activeVerb,
    alreadyActiveMessage: config.alreadyActiveMessage,
    pendingPaymentMessage: config.pendingPaymentMessage,
    paymentType: config.paymentType,
    durationDays: config.durationDays,
    itemDescription: config.itemDescription,
    amountCents: config.amountCents,
    liveOnlyNoun: "businesses",
    auditAction: config.auditAction,
    auditDurationKey: config.auditDurationKey,
    failureMessage: config.failureMessage,
    getEntityId: ({ id }) => id,
    enforceRateLimit: createAddonLocalRateLimitEnforcer(config.rateLimitKey),
    ensureAccountProfile: createAddonAccountProfileGuard(ACCOUNT_PROFILE_WRITE_TABLE),
    findEntity: async ({ params, supabase, user }) => {
      const ownerColumn = await getOwnerColumn(supabase, "businesses");
      const { data: rawBusiness } = await applyOwnerFilter(
        supabase
          .from("businesses")
          .select(
            withOwnerColumn(
              `id, business_name, status, area, owner_id, ${config.activeUntilField}`,
              ownerColumn
            )
          )
          .eq("id", params.id),
        ownerColumn,
        user.id
      ).maybeSingle();

      return rawBusiness as BusinessCheckoutRow | null;
    },
    getNotFoundMessage: "Business not found",
    verifyOwnership: (business, userId) => {
      if (readOwnerId(business) === userId) return null;
      return NextResponse.json(
        { error: "Forbidden — you do not own this business" },
        { status: 403 }
      );
    },
    resolveArea: (business) => business.area as MarketplaceArea,
    entitlementCheck: config.entitlementCheck,
    buildPendingPaymentMatch: (businessId) => ({ business_id: businessId }),
    buildCheckoutPayload: (business, businessId) => ({
      area: business.area as MarketplaceArea,
      itemName: `${config.itemNamePrefix}: ${business.business_name}`,
      providerData: {
        business_id: businessId,
        [config.paymentDurationKey]: config.durationDays,
      },
    }),
    buildAuditPayload: (businessId, area) => ({
      targetType: "business",
      targetId: businessId,
      area,
    }),
  });
}
