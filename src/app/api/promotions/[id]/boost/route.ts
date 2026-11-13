import { BOOST_DURATION_DAYS } from "@/lib/constants/pricing";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

/**
 * POST /api/promotions/[id]/boost
 *
 * Create an Ozow checkout session to boost a standalone promotion.
 * Requires authenticated user who owns the promotion.
 */
export const POST = createAddonCheckoutRouteCore({
  validationErrorMessage: "Invalid Tourism & Events post ID",
  paymentType: "boost_promotion",
  durationDays: BOOST_DURATION_DAYS,
});
