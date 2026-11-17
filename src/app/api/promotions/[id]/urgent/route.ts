import { URGENT_DURATION_DAYS } from "@/lib/constants/pricing";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

/**
 * POST /api/promotions/[id]/urgent
 *
 * Create an Ozow checkout session to mark a promotion as urgent.
 * Requires authenticated user who owns the promotion.
 */
export const POST = createAddonCheckoutRouteCore({
  validationErrorMessage: "Invalid Tourism & Events post ID",
  paymentType: "urgent_promotion",
  durationDays: URGENT_DURATION_DAYS,
});
