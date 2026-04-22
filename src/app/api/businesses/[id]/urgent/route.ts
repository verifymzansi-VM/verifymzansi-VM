import { canUrgent } from "@/lib/services/entitlements";
import { ADDON_PRICES, URGENT_DURATION_DAYS } from "@/lib/constants/pricing";
import { createBusinessAddonCheckoutRoute } from "../_lib/create-addon-checkout-route";

/**
 * POST /api/businesses/[id]/urgent
 *
 * Create an Ozow checkout session to mark a business as urgent.
 */
export const POST = createBusinessAddonCheckoutRoute({
  loggerName: "UrgentBusiness",
  validationErrorMessage: "Invalid business ID",
  rateLimitKey: "business:urgent",
  activeUntilField: "urgent_until",
  activeVerb: "marked urgent",
  alreadyActiveMessage: "This business is already marked urgent",
  pendingPaymentMessage: "An urgent payment is already in progress for this business",
  paymentType: "urgent_business",
  paymentDurationKey: "urgent_days",
  durationDays: URGENT_DURATION_DAYS,
  itemNamePrefix: "Urgent",
  itemDescription: `${URGENT_DURATION_DAYS}-day urgent badge`,
  amountCents: ADDON_PRICES.urgent,
  auditAction: "business_urgent",
  auditDurationKey: "urgentDays",
  failureMessage: "Failed to create urgent checkout",
  entitlementCheck: canUrgent,
});
