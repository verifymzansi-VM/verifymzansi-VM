import { canBoost } from "@/lib/services/entitlements";
import { ADDON_PRICES, BOOST_DURATION_DAYS } from "@/lib/constants/pricing";
import { createListingAddonCheckoutRoute } from "../_lib/create-addon-checkout-route";

/**
 * POST /api/listings/[id]/boost
 *
 * Create an Ozow checkout session to boost a listing.
 * Requires authenticated user who owns the listing, on Growth or Pro plan.
 */
export const POST = createListingAddonCheckoutRoute({
  loggerName: "BoostCheckout",
  validationErrorMessage: "Invalid listing ID",
  rateLimitKey: "listing:boost",
  activeUntilField: "boost_until",
  activeLabel: "boost",
  activeVerb: "boosted",
  alreadyActiveMessage: "This listing is already boosted",
  pendingPaymentMessage: "A boost payment is already in progress for this listing",
  paymentType: "boost",
  paymentIdKey: "listing_id",
  paymentDurationKey: "boost_days",
  durationDays: BOOST_DURATION_DAYS,
  itemNamePrefix: "Boost",
  itemDescription: `${BOOST_DURATION_DAYS}-day listing boost`,
  amountCents: ADDON_PRICES.boost,
  auditAction: "listing_boosted",
  auditDurationKey: "boostDays",
  failureMessage: "Failed to create boost checkout",
  entitlementCheck: canBoost,
});
