import { canBoost } from "@/lib/services/entitlements";
import { ADDON_PRICES, BOOST_DURATION_DAYS } from "@/lib/constants/pricing";
import { createPromotionAddonCheckoutRoute } from "../_lib/create-addon-checkout-route";

/**
 * POST /api/promotions/[id]/boost
 *
 * Create an Ozow checkout session to boost a standalone promotion.
 * Requires authenticated user who owns the promotion.
 */
export const POST = createPromotionAddonCheckoutRoute({
  loggerName: "PromotionBoostCheckout",
  validationErrorMessage: "Invalid promotion ID",
  rateLimitAction: "promotion:boost",
  limitedErrorMessage: "Too many promotion boost attempts. Please try again later.",
  degradedErrorMessage:
    "Promotion checkout protection is temporarily unavailable. Please try again.",
  activeUntilField: "boost_until",
  activeVerb: "boosted",
  alreadyActiveMessage: "This promotion is already boosted",
  pendingPaymentMessage: "A boost payment is already in progress for this promotion",
  paymentType: "boost_promotion",
  paymentDurationKey: "boost_days",
  durationDays: BOOST_DURATION_DAYS,
  itemNamePrefix: "Boost",
  itemDescription: `${BOOST_DURATION_DAYS}-day promotion boost`,
  amountCents: ADDON_PRICES.boost,
  auditAction: "promotion_boosted",
  auditDurationKey: "boostDays",
  failureMessage: "Failed to create boost checkout",
  entitlementCheck: canBoost,
});
