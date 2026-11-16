/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { paymentNoLongerComplete, readPaymentReceipt } from "./payment-receipt";

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

  it("shows the customer's transfer reference for a bank transfer recorded by staff", () => {
    const transfer = {
      ...row,
      provider_transaction_id: null,
      payment_method: "invoice",
      bank_reference: "FNB 2026-11 A1",
    };
    expect(readPaymentReceipt(transfer, expected)).toMatchObject({
      bankReference: "FNB 2026-11 A1",
    });
    // Without its reference the email goes without payment details.
    expect(readPaymentReceipt({ ...transfer, bank_reference: null }, expected)).toBeNull();
    expect(
      readPaymentReceipt({ ...row, payment_method: "ozow", bank_reference: null }, expected)
    ).toMatchObject({ bankReference: "abcdef12345678" });
  });

  it("dates a bank transfer by the day its money cleared, not the confirmation", () => {
    const transfer = {
      ...row,
      provider_transaction_id: null,
      payment_method: "invoice",
      bank_reference: "FNB 2026-11 A1",
      cleared_on: "2026-11-10",
    };
    const receipt = readPaymentReceipt(transfer, expected);
    expect(receipt).toMatchObject({ paidAt: "2026-11-10T12:00:00+02:00" });
    expect(
      new Date(receipt!.paidAt).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg" })
    ).toBe(
      new Date("2026-11-10T10:00:00Z").toLocaleDateString("en-ZA", {
        timeZone: "Africa/Johannesburg",
      })
    );
    // A database without the cleared date: the confirmation time, as before.
    expect(readPaymentReceipt({ ...transfer, cleared_on: undefined }, expected)).toMatchObject({
      paidAt: row.completed_at,
    });
    // An Ozow payment is dated by its settlement whatever else the read holds.
    expect(readPaymentReceipt({ ...row, cleared_on: "2026-11-10" }, expected)).toMatchObject({
      paidAt: row.completed_at,
    });
    expect(readPaymentReceipt({ ...transfer, cleared_on: "10/11/2026" }, expected)).toBeNull();
  });

  it("gives no receipt for a payment that is no longer complete", () => {
    for (const status of ["refunded", "chargeback"]) {
      expect(readPaymentReceipt({ ...row, status }, expected)).toBeNull();
      expect(paymentNoLongerComplete({ ...row, status }, expected)).toBe(true);
    }
    expect(paymentNoLongerComplete(row, expected)).toBe(false);
    // Only for that payment of that member.
    expect(
      paymentNoLongerComplete(
        { ...row, status: "refunded", payment_id: "00000000-0000-4000-8000-0000000000c3" },
        expected
      )
    ).toBe(false);
    expect(paymentNoLongerComplete(null, expected)).toBe(false);
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
