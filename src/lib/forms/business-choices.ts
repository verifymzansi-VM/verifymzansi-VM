/**
 * The fixed business choices, kept free of form and schema code so public
 * pages can read their labels without loading the validation library.
 */

/** Payment methods a business can tick (labels in src/lib/forms/business-form.ts). */
export const PAYMENT_METHODS = [
  "cash",
  "card",
  "eft",
  "snapscan",
  "capitec_pay",
  "zapper",
  "card_machine",
  "cash_on_delivery",
  "instant_eft",
  "other",
] as const;

/** What visitors find at the premises: business_details.visitor_features. */
export const VISITOR_FEATURES = ["parking", "wheelchair_access", "kid_friendly"] as const;
