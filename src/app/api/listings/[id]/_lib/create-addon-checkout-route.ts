import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ACCOUNT_PROFILE_NOT_FOUND_ERROR,
  applyOwnerFilter,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { uuidSchema } from "@/lib/validations/shared";
import type { MarketplaceArea, PlanTier } from "@/types/enums";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

const listingAddonParamsSchema = z.object({
  id: uuidSchema,
});

type ListingCheckoutRow = {
  id: string;
  title: string;
  status: string;
  area?: MarketplaceArea | null;
  owner_id?: string | null;
  seller_id?: string | null;
} & Record<string, string | null | undefined>;

type AllowedResult = {
  allowed: boolean;
  reason?: string;
};

type ListingAddonRouteConfig = {
  loggerName: string;
  validationErrorMessage: string;
  rateLimitKey: string;
  activeUntilField: "featured_until" | "boost_until" | "urgent_until";
  activeLabel: string;
  activeVerb: string;
  alreadyActiveMessage: string;
  pendingPaymentMessage: string;
  paymentType: "featured" | "boost" | "urgent";
  paymentIdKey: "listing_id";
  paymentDurationKey: "feature_days" | "boost_days" | "urgent_days";
  durationDays: number;
  itemNamePrefix: string;
  itemDescription: string;
  amountCents: number;
  auditAction: "listing_featured" | "listing_boosted" | "listing_urgent";
  auditDurationKey: "featureDays" | "boostDays" | "urgentDays";
  failureMessage: string;
  entitlementCheck: (tier: PlanTier, area: MarketplaceArea) => AllowedResult;
};

export function createListingAddonCheckoutRoute(config: ListingAddonRouteConfig) {
  return createAddonCheckoutRouteCore({
    loggerName: config.loggerName,
    paramsSchema: listingAddonParamsSchema,
    validationErrorMessage: config.validationErrorMessage,
    activeUntilField: config.activeUntilField,
    activeVerb: config.activeVerb,
    alreadyActiveMessage: config.alreadyActiveMessage,
    pendingPaymentMessage: config.pendingPaymentMessage,
    paymentType: config.paymentType,
    durationDays: config.durationDays,
    itemDescription: config.itemDescription,
    amountCents: config.amountCents,
    liveOnlyNoun: "listings",
    auditAction: config.auditAction,
    auditDurationKey: config.auditDurationKey,
    failureMessage: config.failureMessage,
    getEntityId: ({ id }) => id,
    enforceRateLimit: async ({ user }) => {
      const rl = checkLocalRateLimit(user.id, config.rateLimitKey);
      if (!rl.limited) return null;
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
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
      const ownerColumn = await getOwnerColumn(supabase, "listings");
      const { data: rawListing } = await applyOwnerFilter(
        supabase
          .from("listings")
          .select(
            withOwnerColumn(
              `id, title, status, area, owner_id, ${config.activeUntilField}`,
              ownerColumn
            )
          )
          .eq("id", params.id),
        ownerColumn,
        user.id
      ).maybeSingle();

      return rawListing as ListingCheckoutRow | null;
    },
    getNotFoundMessage: "Listing not found",
    verifyOwnership: (listing, userId) => {
      if (readOwnerId(listing) === userId) return null;
      return NextResponse.json(
        { error: "Forbidden — you do not own this listing" },
        { status: 403 }
      );
    },
    resolveArea: (listing) => (listing.area || "MZANSI_MARKET") as MarketplaceArea,
    entitlementCheck: config.entitlementCheck,
    buildPendingPaymentMatch: (listingId) => ({ [config.paymentIdKey]: listingId }),
    buildCheckoutPayload: (listing, listingId) => ({
      area: (listing.area || "MZANSI_MARKET") as MarketplaceArea,
      itemName: `${config.itemNamePrefix}: ${listing.title}`,
      providerData: {
        [config.paymentIdKey]: listingId,
        [config.paymentDurationKey]: config.durationDays,
      },
    }),
    buildAuditPayload: (listingId, area) => ({
      targetType: "listing",
      targetId: listingId,
      area,
    }),
  });
}
