/**
 * Paid plans are on sale only while the database catalogue lists one (posting
 * terms posting-v4: paid slots pause until the R69 checkout opens). These are
 * the words every entry point uses while nothing is on sale; the checkout
 * route refuses before it creates a payment or contacts the payment provider.
 */
export const PLAN_SALES_PAUSED_CODE = "plan_sales_paused";

export const PLAN_SALES_PAUSED_MESSAGE = "Paid slots open soon. You have not been charged.";

export const PLAN_SALES_PAUSED_NOTE =
  "Paid slots open soon. Until then, your first post and events are free.";
