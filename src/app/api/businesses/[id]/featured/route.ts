import { FEATURED_DURATION_DAYS } from "@/lib/constants/pricing";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

/**
 * POST /api/businesses/[id]/featured
 *
 * Create an Ozow checkout session to feature a business.
 */
export const POST = createAddonCheckoutRouteCore({
  validationErrorMessage: "Invalid business ID",
  paymentType: "featured_business",
  durationDays: FEATURED_DURATION_DAYS,
});
