import { canUrgent } from "@/lib/services/entitlements";
import { ADDON_PRICES, URGENT_DURATION_DAYS } from "@/lib/constants/pricing";
import { createListingAddonCheckoutRoute } from "../_lib/create-addon-checkout-route";

/**
 * POST /api/listings/[id]/urgent
 *
 * Create an Ozow checkout session to mark a listing as urgent.
 * Requires authenticated user who owns the listing, on Pro plan.
 */
export const POST = createListingAddonCheckoutRoute({
  loggerName: "UrgentCheckout",
  validationErrorMessage: "Invalid listing ID",
  rateLimitKey: "listing:urgent",
  activeUntilField: "urgent_until",
  activeLabel: "urgent",
  activeVerb: "marked urgent",
  alreadyActiveMessage: "This listing is already marked urgent",
  pendingPaymentMessage: "An urgent payment is already in progress for this listing",
  paymentType: "urgent",
  paymentIdKey: "listing_id",
  paymentDurationKey: "urgent_days",
  durationDays: URGENT_DURATION_DAYS,
  itemNamePrefix: "Urgent",
  itemDescription: `${URGENT_DURATION_DAYS}-day urgent listing`,
  amountCents: ADDON_PRICES.urgent,
  auditAction: "listing_urgent",
  auditDurationKey: "urgentDays",
  failureMessage: "Failed to create urgent checkout",
  entitlementCheck: canUrgent,
});
