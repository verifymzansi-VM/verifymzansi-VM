import { env } from "@/lib/config/env";
import { toOzowMerchantReference, type NormalizedOzowWebhook } from "./ozow";
import type { PaymentRecordShape } from "./types";

function parseOzowAmountToCents(amount: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) return null;
  const [whole, fraction = ""] = amount.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

/**
 * Refusals of validateOzowConfirmation that depend on our own state or
 * settings, not on the notice: they may pass once that is put right, so the
 * sender should try again. Every other refusal is final for that notice.
 */
const RETRYABLE_CONFIRMATION_REFUSALS: ReadonlySet<string> = new Set([
  "Invalid Ozow environment",
  "Site code not configured",
  "Missing payment request ID",
]);

export function isRetryableConfirmationRefusal(reason: string): boolean {
  return RETRYABLE_CONFIRMATION_REFUSALS.has(reason);
}

/** A log-safe reason code, e.g. "Amount mismatch" -> "amount_mismatch". */
export function confirmationRefusalCode(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
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
  if (!env("OZOW_SITE_CODE")) return "Site code not configured";
  if (!payload.siteCode || payload.siteCode !== env("OZOW_SITE_CODE")) return "Site code mismatch";
  if (payload.format === "full") {
    if (!["production", "staging"].includes(env("OZOW_ENV") || ""))
      return "Invalid Ozow environment";
    if (payload.isTest === null || payload.isTest !== (env("OZOW_ENV") === "staging"))
      return "Test mode mismatch";
  } else if (env("OZOW_ENV") !== "staging" && payload.isTest === true) {
    // One API transactions (thin-notice lookups, status checks) have no test
    // flag in Ozow's published schema; production reaches only Ozow's live
    // host with live credentials (validateOzowBaseUrl). A flag that is sent and
    // says test, or cannot be read, is refused. Anything but Ozow's test system
    // counts as production.
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
