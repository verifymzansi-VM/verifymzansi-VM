import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { FoundationServiceApi } from "./service-api";
import { createLogger } from "../utils/logger";

/**
 * Payment problems: a signed notice or a status-check transaction that can
 * never be applied, and settlement outcomes that need a person. Each is logged
 * with the payment number and a reason code (never personal data) and kept in
 * the database (api.record_payment_problem, update
 * 20261112080000_payment_problem_alerts.sql), from which the email job alerts
 * staff (./payment-alerts.ts). Recording never changes what happens to the
 * payment.
 */

/** The closed list the database accepts; keep in step with the update. */
export const PAYMENT_PROBLEM_REASONS = [
  // A notice or a status-check transaction refused by validateOzowConfirmation.
  "unsupported_transaction_status",
  "merchant_reference_mismatch",
  "site_code_mismatch",
  "test_mode_mismatch",
  "missing_transaction_id",
  "payment_id_mismatch",
  "transaction_id_mismatch",
  "currency_mismatch",
  "missing_amount",
  "missing_currency",
  "amount_mismatch",
  // A signed notice the route could not read, or that names no payment.
  "invalid_json",
  "missing_merchant_reference",
  "missing_transaction_status",
  "unknown_payment",
  // Settlement outcomes (internal.apply_provider_event) that need a person.
  "unknown_reference",
  "request_mismatch",
  "missing_transaction",
  "conflicting_transaction",
  "transaction_reused",
  "complete_unfulfillable_target",
  "refunded_after_completion",
  // The status check found more than one successful transaction.
  "multiple_settlements",
] as const;
export type PaymentProblemReason = (typeof PAYMENT_PROBLEM_REASONS)[number];
export type PaymentProblemSource = "notice" | "status_check";

const REASONS: ReadonlySet<string> = new Set(PAYMENT_PROBLEM_REASONS);
export const isPaymentProblemReason = (value: string): value is PaymentProblemReason =>
  REASONS.has(value);

/** Which kind of money problem a reason is, for the reasons that email staff
 * at once (a wrong amount, a second payment, money received for something that
 * could not be activated, money returned after activation). */
export type PaymentAnomaly = "wrong_amount" | "paid_twice" | "not_activated" | "refunded";
const ANOMALIES: Partial<Record<PaymentProblemReason, PaymentAnomaly>> = {
  conflicting_transaction: "paid_twice",
  transaction_reused: "paid_twice",
  multiple_settlements: "paid_twice",
  complete_unfulfillable_target: "not_activated",
  refunded_after_completion: "refunded",
};

/** Reasons that need a person only when the bank reports the transaction
 * successful: money moved. A declined or pending attempt with a wrong amount,
 * or a declined second attempt, goes into the daily summary only. */
const WHEN_PAID: Partial<Record<PaymentProblemReason, PaymentAnomaly>> = {
  amount_mismatch: "wrong_amount",
  currency_mismatch: "wrong_amount",
  transaction_id_mismatch: "paid_twice",
};

/** The anomaly a problem is, or null when it only goes into the daily summary. */
export function paymentAnomaly(
  reason: PaymentProblemReason,
  reportedStatus?: string | null
): PaymentAnomaly | null {
  const whenPaid = WHEN_PAID[reason];
  if (whenPaid) return reportedStatus?.toLowerCase() === "successful" ? whenPaid : null;
  return ANOMALIES[reason] ?? null;
}

/** Plain words for each reason, for staff emails. */
export const PAYMENT_PROBLEM_LABELS: Record<PaymentProblemReason, string> = {
  unsupported_transaction_status: "The bank reported a status this site does not handle",
  merchant_reference_mismatch: "The payment reference did not match",
  site_code_mismatch: "The notice was for another Ozow site",
  test_mode_mismatch: "A test payment reached the live site, or the reverse",
  missing_transaction_id: "The notice had no transaction number",
  payment_id_mismatch: "The notice was for another payment request",
  transaction_id_mismatch: "A second transaction on a payment that is already complete",
  currency_mismatch: "Wrong currency",
  missing_amount: "A successful payment without an amount",
  missing_currency: "A successful payment without a currency",
  amount_mismatch: "Wrong amount",
  invalid_json: "A signed notice that could not be read",
  missing_merchant_reference: "A signed notice without a payment reference",
  missing_transaction_status: "A signed notice without a status",
  unknown_payment: "A signed notice for a payment this site does not have",
  unknown_reference: "Settlement found no payment for the reference",
  request_mismatch: "Settlement did not match the payment request",
  missing_transaction: "Settlement without a transaction number",
  conflicting_transaction: "Paid twice: a second successful transaction",
  transaction_reused: "One bank transaction was used for two payments",
  complete_unfulfillable_target: "Paid, but the plan or add-on could not be activated",
  refunded_after_completion: "Money returned at the bank after the plan was activated",
  multiple_settlements: "Paid twice: the status check found two successful transactions",
};

const log = createLogger("PaymentProblems");
const recorded = z.looseObject({ new: z.boolean(), alert: z.boolean() });

export interface PaymentProblem {
  paymentId: string | null;
  /** A reason code; one outside PAYMENT_PROBLEM_REASONS is logged only. */
  reason: string;
  source: PaymentProblemSource;
  /** The status the bank reported, when known (see paymentAnomaly). */
  reportedStatus?: string | null;
  /** The Ozow transaction (or a key for a set of them) that showed the
   * problem. After the alert was sent, a repeat from another transaction
   * alerts staff again. */
  transaction?: string | null;
}

/** How long recording may hold up a reply (the notice route answers Ozow). */
const RECORD_TIMEOUT_MS = 3_000;

/** A transaction key within the database's 100 characters. */
function transactionKey(value: string | null | undefined) {
  if (!value) return null;
  return value.length <= 100 ? value : createHash("sha256").update(value).digest("hex");
}

/**
 * Logs one problem ("Payment problem", with the payment number and reason
 * code) and keeps it in the database. Never throws and never waits more than
 * three seconds: a problem that cannot be stored in time (database slow or
 * unavailable, the update not applied yet, or no service binding) is logged as
 * such and the caller carries on exactly as before. `service` may be a
 * factory, so a caller without a database binding still gets the log line.
 */
export async function recordPaymentProblem(
  service: FoundationServiceApi | (() => FoundationServiceApi),
  problem: PaymentProblem
): Promise<void> {
  const reason = isPaymentProblemReason(problem.reason) ? problem.reason : null;
  const anomaly =
    reason && problem.paymentId ? paymentAnomaly(reason, problem.reportedStatus) : null;
  const meta = {
    paymentId: problem.paymentId,
    reason: problem.reason,
    source: problem.source,
    ...(anomaly ? { anomaly } : {}),
  };
  (anomaly ? log.error : log.warn)("Payment problem", meta);
  if (!reason) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const api = typeof service === "function" ? service() : service;
    const signal = AbortSignal.timeout(RECORD_TIMEOUT_MS);
    const request = api.rpc("record_payment_problem", {
      p_payment_id: problem.paymentId,
      p_reason: reason,
      p_source: problem.source,
      p_alert: anomaly !== null,
      p_transaction: transactionKey(problem.transaction),
    }) as PromiseLike<{ data: unknown; error: unknown }> & {
      abortSignal?: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;
    };
    const { data, error } = await Promise.race([
      typeof request.abortSignal === "function" ? request.abortSignal(signal) : request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), RECORD_TIMEOUT_MS);
      }),
    ]);
    if (error || !recorded.safeParse(data).success) throw new Error("not recorded");
  } catch {
    log.error("Payment problem could not be recorded", meta);
  } finally {
    clearTimeout(timer);
  }
}
