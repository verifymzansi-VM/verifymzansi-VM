import { env } from "@/lib/config/env";
import { toOzowMerchantReference, type NormalizedOzowWebhook } from "./ozow";
import type { PaymentRecordShape } from "./types";

function parseOzowAmountToCents(amount: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) return null;
  const [whole, fraction = ""] = amount.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

/** Only authenticated Ozow evidence may be passed here, never browser fields. */
export function validateOzowConfirmation(
  payment: PaymentRecordShape,
  payload: NormalizedOzowWebhook
): string | null {
  const status = payload.status?.toLowerCase() || "";
  const validStatuses =
    payload.format === "full"
      ? ["successful", "error", "pending", "incomplete"]
      : ["successful", "error", "pending", "incomplete", "refunded"];
  if (!validStatuses.includes(status)) return "Unsupported transaction status";
  const expectedReference = payment.provider_reference || toOzowMerchantReference(payment.id);
  if (payload.merchantReference !== expectedReference) return "Merchant reference mismatch";
  if (!payload.siteCode || payload.siteCode !== env("OZOW_SITE_CODE")) return "Site code mismatch";
  if (payload.format === "full") {
    if (!["production", "staging"].includes(env("OZOW_ENV") || ""))
      return "Invalid Ozow environment";
    if (payload.isTest === null || payload.isTest !== (env("OZOW_ENV") === "staging"))
      return "Test mode mismatch";
  }
  if (!payload.transactionId) return "Missing transaction ID";
  if (!payment.provider_payment_id) return "Missing payment request ID";
  if (payload.providerPaymentId && payload.providerPaymentId !== payment.provider_payment_id)
    return "Payment ID mismatch";
  const existingTransaction = payment.provider_data?.transaction_id;
  if (existingTransaction && existingTransaction !== payload.transactionId)
    return "Transaction ID mismatch";
  if (payload.currencyCode && payload.currencyCode.toUpperCase() !== "ZAR")
    return "Currency mismatch";
  const successful = payload.status?.toLowerCase() === "successful";
  if (successful && !payload.amount) return "Missing amount";
  if (successful && !payload.currencyCode) return "Missing currency";
  if (payload.amount && parseOzowAmountToCents(payload.amount) !== payment.amount_cents)
    return "Amount mismatch";
  return null;
}
