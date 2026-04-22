import { canBoost } from "@/lib/services/entitlements";
import { ADDON_PRICES, BOOST_DURATION_DAYS } from "@/lib/constants/pricing";
import { createBusinessAddonCheckoutRoute } from "../_lib/create-addon-checkout-route";

/**
 * POST /api/businesses/[id]/boost
 *
 * Create an Ozow checkout session to boost a business.
 */
export const POST = createBusinessAddonCheckoutRoute({
  loggerName: "BoostBusiness",
  validationErrorMessage: "Invalid business ID",
  rateLimitKey: "business:boost",
  activeUntilField: "boost_until",
  activeVerb: "boosted",
  alreadyActiveMessage: "This business is already boosted",
  pendingPaymentMessage: "A boost payment is already in progress for this business",
  paymentType: "boost_business",
  paymentDurationKey: "boost_days",
  durationDays: BOOST_DURATION_DAYS,
  itemNamePrefix: "Boost",
  itemDescription: `${BOOST_DURATION_DAYS}-day business boost`,
  amountCents: ADDON_PRICES.boost,
  auditAction: "business_boosted",
  auditDurationKey: "boostDays",
  failureMessage: "Failed to create boost checkout",
  entitlementCheck: canBoost,
});
