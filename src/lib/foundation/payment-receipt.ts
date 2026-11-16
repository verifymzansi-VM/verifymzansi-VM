import { z } from "zod";
import { toOzowReferenceField } from "../payments/ozow-reference";
import type { PaymentReceipt } from "../services/payment-receipt-email";

const time = z.iso.datetime({ offset: true });
// What api.get_payment_receipt returns for one payment and its invoice
// (database/foundation/current/functions/internal/get_payment_receipt.sql).
// Fields the email does not use are not read.
const receiptRow = z.object({
  payment_id: z.uuid(),
  owner_id: z.uuid(),
  amount_cents: z.number().int().positive().max(100_000_000),
  currency: z.literal("ZAR"),
  completed_at: time.nullable(),
  product_kind: z.enum(["plan", "addon"]),
  label: z.string().trim().min(1).max(200),
  invoice_description: z.string().trim().min(1).max(300).nullable(),
  invoice_number: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,39}$/)
    .nullable(),
  issued_at: time.nullable(),
  merchant_reference: z.string().min(1).max(100),
  // A bank transfer recorded by staff ('invoice') shows the reference of the
  // customer's transfer; older reads have neither field (an Ozow payment).
  payment_method: z.enum(["ozow", "invoice"]).optional(),
  bank_reference: z.string().trim().min(4).max(60).nullable().optional(),
  // The date the money of a bank transfer cleared (South African date), from
  // 20261113223806_bank_transfer_and_consent_fixes.sql; absent before it.
  cleared_on: z.iso.date().nullable().optional(),
  // The payment's status now: a payment refunded or charged back before its
  // receipt went out is no longer "received".
  status: z.string().max(40).optional(),
});

type Expected = { paymentId: string; ownerId: string | null | undefined };

/**
 * True when the read describes that payment of that member and the payment is
 * no longer complete (refunded or charged back before the receipt went out):
 * the receipt, with or without details, must not be sent.
 */
export function paymentNoLongerComplete(data: unknown, expected: Expected): boolean {
  const row = receiptRow.safeParse(data);
  return (
    row.success &&
    row.data.payment_id === expected.paymentId &&
    row.data.owner_id === expected.ownerId &&
    row.data.status !== undefined &&
    row.data.status !== "complete"
  );
}

/**
 * The receipt for a settled payment, or null when the read does not describe
 * that payment of that member with an invoice (an unknown payment reads as
 * null), or the payment is no longer complete. The caller then sends the
 * notice without payment details, unless paymentNoLongerComplete says no
 * receipt is due at all.
 */
export function readPaymentReceipt(data: unknown, expected: Expected): PaymentReceipt | null {
  const row = receiptRow.safeParse(data);
  if (!row.success) return null;
  const r = row.data;
  const bank = r.payment_method === "invoice";
  // A bank transfer was paid the day its money cleared, not when a second
  // staff member confirmed it (noon, so the South African date always shows).
  const paidAt =
    bank && r.cleared_on ? `${r.cleared_on}T12:00:00+02:00` : (r.completed_at ?? r.issued_at);
  const bankReference = bank
    ? (r.bank_reference ?? "")
    : toOzowReferenceField(r.merchant_reference);
  if (
    r.payment_id !== expected.paymentId ||
    r.owner_id !== expected.ownerId ||
    (r.status !== undefined && r.status !== "complete") ||
    !r.invoice_number ||
    !paidAt ||
    !bankReference
  )
    return null;
  return {
    kind: r.product_kind,
    invoiceNumber: r.invoice_number,
    paidAt,
    item: r.invoice_description ?? r.label,
    amountCents: r.amount_cents,
    bankReference,
  };
}
