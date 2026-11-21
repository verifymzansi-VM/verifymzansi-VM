import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { settleStaffCommand } from "./staff-command";

/**
 * Sales figures for staff (20261121090305_staff_sales_and_vat.sql), computed
 * by the database from the payment records. A payment's sale is its amount
 * less any refunded or charged-back slots (nothing once the whole payment was
 * reversed), counted on the day it was paid.
 */
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const cents = z.number().int().nonnegative();

/** Sales of the last 12 months against the VAT registration levels; the
 * alert is on when not registered for VAT and the total reached the alert
 * level. Also in the daily payment summary (./payment-alerts.ts). */
export const vatSalesPositionSchema = z.strictObject({
  since: instant,
  payments: count,
  net_cents: cents,
  vat_status: z.enum(["not_registered", "registered", "undecided"]),
  alert_cents: cents,
  compulsory_cents: cents,
  alert: z.boolean(),
});
export type VatSalesPosition = z.infer<typeof vatSalesPositionSchema>;

export const SALES_CATEGORY_LABELS = {
  individual: "Individual slot",
  package: "Multi-listing package",
  add_on: "Add-on",
  other: "Other",
} as const;

const staffSalesSummarySchema = z.strictObject({
  generated_at: instant,
  vat: vatSalesPositionSchema,
  products: z
    .array(
      z.strictObject({
        category: z.enum(["individual", "package", "add_on", "other"]),
        term_days: z.number().int().positive().nullable(),
        payments: count,
        net_cents: cents,
      })
    )
    .max(100),
  checkouts: z.strictObject({
    days: z.literal(30),
    started: count,
    paid: count,
    failed: count,
    cancelled: count,
    expired: count,
    open: count,
  }),
});
export type StaffSalesSummary = z.infer<typeof staffSalesSummarySchema>;

/** The staff payments page's sales figures (`payments:view`). */
export async function readStaffSalesSummary(
  api: FoundationAuthenticatedApi
): Promise<StaffSalesSummary> {
  return settleStaffCommand(
    api.rpc("get_staff_sales_summary", {}, { get: false }),
    staffSalesSummarySchema
  );
}

/** Share of started online checkouts that were not paid, in whole percent;
 * null before any checkout started. */
export function checkoutDropOffPercent(checkouts: StaffSalesSummary["checkouts"]) {
  if (checkouts.started === 0) return null;
  return Math.round(((checkouts.started - checkouts.paid) / checkouts.started) * 100);
}
