import { URGENT_DURATION_DAYS } from "@/lib/constants/pricing";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

/**
 * POST /api/listings/[id]/urgent
 *
 * Create an Ozow checkout session to mark a listing as urgent.
 * Requires an authenticated owner with a paid plan (30, 90 or 180 days, or multi-listing).
 */
export const POST = createAddonCheckoutRouteCore({
  validationErrorMessage: "Invalid listing ID",
  paymentType: "urgent",
  durationDays: URGENT_DURATION_DAYS,
});
