import { canFeatured } from "@/lib/services/entitlements";
import { ADDON_PRICES, FEATURED_DURATION_DAYS } from "@/lib/constants/pricing";
import { createListingAddonCheckoutRoute } from "../_lib/create-addon-checkout-route";

/**
 * POST /api/listings/[id]/featured
 *
 * Create an Ozow checkout session to feature a listing.
 * Requires authenticated user who owns the listing, on Pro plan.
 */
export const POST = createListingAddonCheckoutRoute({
  loggerName: "FeaturedCheckout",
  validationErrorMessage: "Invalid listing ID",
  rateLimitKey: "listing:featured",
  activeUntilField: "featured_until",
  activeLabel: "featured",
  activeVerb: "featured",
  alreadyActiveMessage: "This listing is already featured",
  pendingPaymentMessage: "A featured payment is already in progress for this listing",
  paymentType: "featured",
  paymentIdKey: "listing_id",
  paymentDurationKey: "feature_days",
  durationDays: FEATURED_DURATION_DAYS,
  itemNamePrefix: "Featured",
  itemDescription: `${FEATURED_DURATION_DAYS}-day featured listing`,
  amountCents: ADDON_PRICES.featured,
  auditAction: "listing_featured",
  auditDurationKey: "featureDays",
  failureMessage: "Failed to create featured checkout",
  entitlementCheck: canFeatured,
});
