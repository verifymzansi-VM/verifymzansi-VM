import { canFeatured } from "@/lib/services/entitlements";
import { ADDON_PRICES, FEATURED_DURATION_DAYS } from "@/lib/constants/pricing";
import { createBusinessAddonCheckoutRoute } from "../_lib/create-addon-checkout-route";

/**
 * POST /api/businesses/[id]/featured
 *
 * Create an Ozow checkout session to feature a business.
 */
export const POST = createBusinessAddonCheckoutRoute({
  loggerName: "FeaturedBusiness",
  validationErrorMessage: "Invalid business ID",
  rateLimitKey: "business:featured",
  activeUntilField: "featured_until",
  activeVerb: "featured",
  alreadyActiveMessage: "This business is already featured",
  pendingPaymentMessage: "A featured payment is already in progress for this business",
  paymentType: "featured_business",
  paymentDurationKey: "feature_days",
  durationDays: FEATURED_DURATION_DAYS,
  itemNamePrefix: "Featured",
  itemDescription: `${FEATURED_DURATION_DAYS}-day business feature`,
  amountCents: ADDON_PRICES.featured,
  auditAction: "business_featured",
  auditDurationKey: "featureDays",
  failureMessage: "Failed to create featured checkout",
  entitlementCheck: canFeatured,
});
