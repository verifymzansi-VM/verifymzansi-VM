import { URGENT_DURATION_DAYS } from "@/lib/constants/pricing";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

/**
 * POST /api/businesses/[id]/urgent
 *
 * Create an Ozow checkout session to mark a business as urgent.
 */
export const POST = createAddonCheckoutRouteCore({
  validationErrorMessage: "Invalid business ID",
  paymentType: "urgent_business",
  durationDays: URGENT_DURATION_DAYS,
});
