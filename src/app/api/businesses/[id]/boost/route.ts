import { BOOST_DURATION_DAYS } from "@/lib/constants/pricing";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

/**
 * POST /api/businesses/[id]/boost
 *
 * Create an Ozow checkout session to boost a business.
 */
export const POST = createAddonCheckoutRouteCore({
  validationErrorMessage: "Invalid business ID",
  paymentType: "boost_business",
  durationDays: BOOST_DURATION_DAYS,
});
