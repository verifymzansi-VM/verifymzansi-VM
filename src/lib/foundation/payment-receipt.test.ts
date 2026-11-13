/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { readPaymentReceipt } from "./payment-receipt";

const paymentId = "00000000-0000-4000-8000-0000000000a1";
const ownerId = "00000000-0000-4000-8000-0000000000b2";
const row = {
  payment_id: paymentId,
  owner_id: ownerId,
  amount_cents: 20700,
  currency: "ZAR",
  completed_at: "2026-11-13T07:15:00.123456+00:00",
  product_kind: "plan",
  label: "Individual slot — 90 days",
  slots: 3,
  invoice_description: "3 × Individual slot — 90 days",
  invoice_number: "INV-20261113-ABCDEF1234",
  issued_at: "2026-11-13T07:15:01+00:00",
  merchant_reference: "abcdef12345678901234567890abcdef",
  provider_transaction_id: "synthetic-transaction",
  status: "complete",
  fulfillment_status: "fulfilled",
};
const expected = { paymentId, ownerId };

describe("readPaymentReceipt", () => {
  it("keeps only what the email shows, with the bank statement reference", () => {
    expect(readPaymentReceipt(row, expected)).toEqual({
      kind: "plan",
      invoiceNumber: "INV-20261113-ABCDEF1234",
      paidAt: "2026-11-13T07:15:00.123456+00:00",
      item: "3 × Individual slot — 90 days",
      amountCents: 20700,
      bankReference: "abcdef12345678",
    });
  });

  it("falls back to the label and the invoice time when those are missing", () => {
    expect(
      readPaymentReceipt(
        { ...row, product_kind: "addon", invoice_description: null, completed_at: null },
        expected
      )
    ).toMatchObject({
      kind: "addon",
      item: "Individual slot — 90 days",
      paidAt: "2026-11-13T07:15:01+00:00",
    });
  });

  it.each([
    ["an unknown payment", null],
    ["another payment", { ...row, payment_id: "00000000-0000-4000-8000-0000000000c3" }],
    ["another member", { ...row, owner_id: "00000000-0000-4000-8000-0000000000d4" }],
    ["no invoice", { ...row, invoice_number: null }],
    ["no payment time", { ...row, completed_at: null, issued_at: null }],
    ["another currency", { ...row, currency: "USD" }],
    ["a zero amount", { ...row, amount_cents: 0 }],
    ["a fractional amount", { ...row, amount_cents: 69.5 }],
    ["an unexpected invoice number", { ...row, invoice_number: "<b>INV</b>" }],
    ["no usable reference", { ...row, merchant_reference: "____" }],
  ])("returns null for %s", (_name, data) => {
    expect(readPaymentReceipt(data, expected)).toBeNull();
  });

  it("returns null when the message names no member", () => {
    expect(readPaymentReceipt(row, { paymentId, ownerId: null })).toBeNull();
  });
});
