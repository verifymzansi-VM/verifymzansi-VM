import { BOOST_DURATION_DAYS } from "@/lib/constants/pricing";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

/**
 * POST /api/listings/[id]/boost
 *
 * Create an Ozow checkout session to boost a listing.
 * Requires an authenticated owner with a paid plan (30, 90 or 180 days, or multi-listing).
 */
export const POST = createAddonCheckoutRouteCore({
  validationErrorMessage: "Invalid listing ID",
  paymentType: "boost",
  durationDays: BOOST_DURATION_DAYS,
});
