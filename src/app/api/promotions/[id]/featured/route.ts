import { FEATURED_DURATION_DAYS } from "@/lib/constants/pricing";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

/**
 * POST /api/promotions/[id]/featured
 *
 * Create an Ozow checkout session to feature a standalone promotion.
 * Requires authenticated user who owns the promotion.
 */
export const POST = createAddonCheckoutRouteCore({
  validationErrorMessage: "Invalid Tourism & Events post ID",
  paymentType: "featured_promotion",
  durationDays: FEATURED_DURATION_DAYS,
});
