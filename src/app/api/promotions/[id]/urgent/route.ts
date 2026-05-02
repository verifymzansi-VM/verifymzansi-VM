import { canUrgent } from "@/lib/services/entitlements";
import { ADDON_PRICES, URGENT_DURATION_DAYS } from "@/lib/constants/pricing";
import { createPromotionAddonCheckoutRoute } from "../_lib/create-addon-checkout-route";

/**
 * POST /api/promotions/[id]/urgent
 *
 * Create an Ozow checkout session to mark a promotion as urgent.
 * Requires authenticated user who owns the promotion.
 */
export const POST = createPromotionAddonCheckoutRoute({
  loggerName: "PromotionUrgentCheckout",
  validationErrorMessage: "Invalid Tourism & Events post ID",
  rateLimitAction: "promotion:urgent",
  limitedErrorMessage: "Too many Tourism & Events urgent attempts. Please try again later.",
  degradedErrorMessage:
    "Tourism & Events checkout protection is temporarily unavailable. Please try again.",
  activeUntilField: "urgent_until",
  activeVerb: "marked urgent",
  alreadyActiveMessage: "This Tourism & Events post is already marked urgent",
  pendingPaymentMessage: "An urgent payment is already in progress for this Tourism & Events post",
  paymentType: "urgent_promotion",
  paymentDurationKey: "urgent_days",
  durationDays: URGENT_DURATION_DAYS,
  itemNamePrefix: "Urgent",
  itemDescription: `${URGENT_DURATION_DAYS}-day urgent badge`,
  amountCents: ADDON_PRICES.urgent,
  auditAction: "promotion_urgent",
  auditDurationKey: "urgentDays",
  failureMessage: "Failed to create urgent checkout",
  entitlementCheck: canUrgent,
  requireOwnerMatch: true,
  includeAuditArea: true,
});
