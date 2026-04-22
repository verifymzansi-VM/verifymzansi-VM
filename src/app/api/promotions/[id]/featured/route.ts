import { canFeatured } from "@/lib/services/entitlements";
import { ADDON_PRICES, FEATURED_DURATION_DAYS } from "@/lib/constants/pricing";
import { createPromotionAddonCheckoutRoute } from "../_lib/create-addon-checkout-route";

/**
 * POST /api/promotions/[id]/featured
 *
 * Create an Ozow checkout session to feature a standalone promotion.
 * Requires authenticated user who owns the promotion.
 */
export const POST = createPromotionAddonCheckoutRoute({
  loggerName: "PromotionFeaturedCheckout",
  validationErrorMessage: "Invalid promotion ID",
  rateLimitAction: "promotion:featured",
  limitedErrorMessage: "Too many promotion feature attempts. Please try again later.",
  degradedErrorMessage:
    "Promotion checkout protection is temporarily unavailable. Please try again.",
  activeUntilField: "featured_until",
  activeVerb: "featured",
  alreadyActiveMessage: "This promotion is already featured",
  pendingPaymentMessage: "A featured payment is already in progress for this promotion",
  paymentType: "featured_promotion",
  paymentDurationKey: "feature_days",
  durationDays: FEATURED_DURATION_DAYS,
  itemNamePrefix: "Featured",
  itemDescription: `${FEATURED_DURATION_DAYS}-day promotion feature`,
  amountCents: ADDON_PRICES.featured,
  auditAction: "promotion_featured",
  auditDurationKey: "featureDays",
  failureMessage: "Failed to create featured checkout",
  entitlementCheck: canFeatured,
});
