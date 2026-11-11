import { FEATURED_DURATION_DAYS } from "@/lib/constants/pricing";
import { createAddonCheckoutRouteCore } from "@/app/api/_lib/create-addon-checkout-route-core";

/**
 * POST /api/listings/[id]/featured
 *
 * Create an Ozow checkout session to feature a listing.
 * Requires an authenticated owner with a paid plan (30, 90 or 180 days, or multi-listing).
 */
export const POST = createAddonCheckoutRouteCore({
  validationErrorMessage: "Invalid listing ID",
  paymentType: "featured",
  durationDays: FEATURED_DURATION_DAYS,
});
