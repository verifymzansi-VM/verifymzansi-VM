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
  validationErrorMessage: "Invalid Tourism & Events post ID",
  rateLimitAction: "promotion:boost",
  limitedErrorMessage: "Too many Tourism & Events boost attempts. Please try again later.",
  degradedErrorMessage:
    "Tourism & Events checkout protection is temporarily unavailable. Please try again.",
  activeUntilField: "boost_until",
  activeVerb: "boosted",
  alreadyActiveMessage: "This Tourism & Events post is already boosted",
  pendingPaymentMessage: "A boost payment is already in progress for this Tourism & Events post",
  paymentType: "boost_promotion",
  paymentDurationKey: "boost_days",
  durationDays: BOOST_DURATION_DAYS,
  itemNamePrefix: "Boost",
  itemDescription: `${BOOST_DURATION_DAYS}-day Tourism & Events boost`,
  amountCents: ADDON_PRICES.boost,
  auditAction: "promotion_boosted",
  auditDurationKey: "boostDays",
  failureMessage: "Failed to create boost checkout",
  entitlementCheck: canBoost,
});
