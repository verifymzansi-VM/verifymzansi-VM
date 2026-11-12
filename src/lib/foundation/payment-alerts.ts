import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  sendStaffOperationsEmail,
  type SendEmailResult,
  type StaffEmailSection,
} from "../services/email";
import { createLogger } from "../utils/logger";
import {
  isPaymentProblemReason,
  PAYMENT_PROBLEM_LABELS,
  paymentAnomaly,
  type PaymentAnomaly,
} from "./payment-problems";

/**
 * Staff emails about payment problems, sent by the email job (every minute,
 * ./operation-jobs.ts) from what the website recorded (./payment-problems.ts):
 * - at once: one email listing every problem that needs a person (a wrong
 *   amount, a second payment, money received for something that could not be
 *   activated, money returned after activation) not emailed yet;
 * - once a day from 07:00 South African time: a summary of the problems seen
 *   since the previous summary, the payments still waiting for staff and the
 *   payment activity.
 * Both go to PAYMENT_ALERT_EMAILS (one to three addresses, comma separated; a
 * Worker secret). They hold payment numbers, Ozow references, amounts and
 * reason codes, never a member's name or contact details.
 */

const PAYMENT_ALERT_RECIPIENTS_ENV = "PAYMENT_ALERT_EMAILS";
const MAX_RECIPIENTS = 3;
/** Problems in one alert email. */
const PAYMENT_ALERT_LIMIT = 20;
/** The daily summary goes out with the first email job run from this hour
 * (South African time). */
const PAYMENT_SUMMARY_HOUR = 7;
/** Payment numbers listed per section of the daily summary. */
const SUMMARY_LIST_LIMIT = 20;

const log = createLogger("PaymentAlerts");

/**
 * The staff addresses, or null when none is configured (or the setting is not
 * one to three valid addresses). Logged loudly by the caller; nothing about
 * payments themselves depends on it.
 */
export function paymentAlertRecipients(
  environment: Record<string, string | undefined> = process.env
) {
  const raw = environment[PAYMENT_ALERT_RECIPIENTS_ENV]?.trim();
  if (!raw) return null;
  const addresses = raw.split(",").map((value) => value.trim());
  const valid = z.array(z.email().max(254)).min(1).max(MAX_RECIPIENTS).safeParse(addresses);
  if (!valid.success || new Set(addresses.map((a) => a.toLowerCase())).size !== addresses.length) {
    log.error("Payment alert recipients are invalid", {
      setting: PAYMENT_ALERT_RECIPIENTS_ENV,
      count: addresses.length,
    });
    return null;
  }
  return valid.data;
}

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
export interface PaymentAlertContext {
  /** The email job's database call (time-limited, never throws). */
  call: (
    name: string,
    args: Record<string, unknown>,
    signal?: () => AbortSignal
  ) => Promise<RpcResult>;
  claimSignal: () => AbortSignal;
  /** A claim and a worst-case send still fit in this run. */
  canClaim: () => boolean;
  /** Spaces sends to the email provider's rate. */
  pace: <T>(send: () => Promise<T>) => Promise<T>;
}
export interface PaymentAlertOptions {
  send?: typeof sendStaffOperationsEmail;
  recipients?: () => string[] | null;
  fromHour?: number;
}
export type PaymentAlertStep = (context: PaymentAlertContext) => Promise<string[]>;

const instant = z.string().pipe(z.iso.datetime({ offset: true }));
const alertClaimSchema = z.object({
  claim: z.uuid().nullable(),
  problems: z
    .array(
      z.object({
        id: z.uuid(),
        payment_id: z.uuid(),
        reason: z.string().regex(/^[a-z_]{1,64}$/),
        source: z.enum(["notice", "status_check"]),
        first_seen_at: instant,
        merchant_reference: z.string().min(1).max(100),
        amount_cents: z.string().regex(/^[0-9]{1,12}$/),
        status: z.string().regex(/^[a-z_]{1,32}$/),
        fulfillment_status: z.string().regex(/^[a-z_]{1,32}$/),
        product_kind: z.string().regex(/^[a-z_]{1,32}$/),
      })
    )
    .max(50),
});
type ClaimedProblem = z.infer<typeof alertClaimSchema>["problems"][number];
const paymentList = z.object({
  total: z.number().int().nonnegative(),
  payment_ids: z.array(z.uuid()).max(50),
});
const digestSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  claim: z.uuid(),
  window_start: instant,
  window_end: instant,
  problems: z.object({
    total: z.number().int().nonnegative(),
    items: z
      .array(
        z.object({
          payment_id: z.uuid().nullable(),
          reason: z.string().regex(/^[a-z_]{1,64}$/),
          source: z.enum(["notice", "status_check"]),
          first_seen_at: instant,
          last_seen_at: instant,
          occurrences: z.number().int().positive(),
          needs_alert: z.boolean(),
          alerted: z.boolean(),
        })
      )
      .max(50),
  }),
  not_activated: paymentList,
  stale_pending: paymentList,
  unalerted: z.number().int().nonnegative(),
  outcomes: z.record(z.string().regex(/^[a-z_]{1,64}$/), z.number().int().nonnegative()),
});
type Digest = z.infer<typeof digestSchema>;

const ANOMALY_WORDS: Record<PaymentAnomaly, string> = {
  wrong_amount: "wrong amount",
  paid_twice: "paid twice",
  not_activated: "paid but not activated",
  refunded: "money returned after activation",
};
const OUTCOME_WORDS: Record<string, string> = {
  completed: "Paid and activated",
  complete_unfulfillable_target: "Paid but not activated",
  not_paid: "Not paid (declined or cancelled at the bank)",
  no_change: "Still being decided at the bank",
  already_complete: "Repeat of a payment already recorded",
  duplicate_event: "Repeated notices",
  late_status_ignored: "Later status for a completed payment",
  reversed_ignored: "Notice for a refunded payment",
  conflicting_transaction: "Second successful transaction",
  transaction_reused: "Bank transaction used twice",
  amount_mismatch: "Wrong amount",
  request_mismatch: "Wrong payment request",
  missing_transaction: "No transaction number",
  unknown_reference: "Unknown payment reference",
};
const SOURCE_WORDS = { notice: "the payment notice", status_check: "the 10-minute status check" };

const label = (reason: string) =>
  isPaymentProblemReason(reason) ? PAYMENT_PROBLEM_LABELS[reason] : reason.replace(/_/g, " ");
const rand = (cents: string) => `R ${(Number(cents) / 100).toFixed(2)}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
function sast(iso: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
/** The same set of problems always gives the same key and the same email. */
function alertKey(problems: readonly ClaimedProblem[]) {
  const ids = problems.map((problem) => problem.id).sort();
  return `payment-alert/${createHash("sha256").update(ids.join(",")).digest("hex")}`;
}
const delivered = (result: SendEmailResult | null) =>
  // A refused repeat of the same key means that earlier request may have gone out.
  result !== null && (result.success || result.outcomeUnknown === true);

export function paymentAlertEmail(recipients: readonly string[], problems: ClaimedProblem[]) {
  const kinds = [
    ...new Set(
      problems.map((problem) => {
        const anomaly = isPaymentProblemReason(problem.reason)
          ? paymentAnomaly(problem.reason, "successful")
          : null;
        return anomaly ? ANOMALY_WORDS[anomaly] : label(problem.reason).toLowerCase();
      })
    ),
  ];
  const count = plural(problems.length, "payment");
  return {
    to: recipients,
    idempotencyKey: alertKey(problems),
    subject: `VerifyMzansi payment alert: ${count} need${problems.length === 1 ? "s" : ""} attention (${kinds.join(", ")})`,
    title: problems.length === 1 ? "A payment needs attention" : "Payments need attention",
    intro:
      "The payment checks flagged the payments below. Nothing was changed automatically: no plan was taken away and no money was returned.",
    sections: problems.map((problem): StaffEmailSection => ({
      heading: label(problem.reason),
      rows: [
        ["Payment number", problem.payment_id],
        ["Ozow reference", problem.merchant_reference],
        ["Amount", rand(problem.amount_cents)],
        ["Payment", `${problem.product_kind}, ${problem.status}, ${problem.fulfillment_status}`],
        ["Found by", SOURCE_WORDS[problem.source]],
        ["First seen", sast(problem.first_seen_at)],
      ],
    })),
    closing:
      "Look each payment up in Ozow's merchant portal by its Ozow reference and in the staff payments list by its payment number. This email holds no member details. The website's log lists each problem under 'Payment problem' with the same payment number and reason.",
    reason:
      "The VerifyMzansi email job sends payment alerts to the addresses in PAYMENT_ALERT_EMAILS.",
    tone: "warning" as const,
  };
}

export function paymentSummaryEmail(recipients: readonly string[], digest: Digest) {
  const waiting = digest.not_activated.total + digest.stale_pending.total;
  const activity = Object.entries(digest.outcomes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([outcome, total]): [string, string] => [OUTCOME_WORDS[outcome] ?? outcome, `${total}`]);
  const problems = digest.problems.items.map((item): [string, string] => [
    label(item.reason),
    [
      item.payment_id ?? "no payment matched",
      `seen ${plural(item.occurrences, "time")}, last ${sast(item.last_seen_at)}`,
      ...(item.needs_alert ? [item.alerted ? "alert sent" : "alert not sent yet"] : []),
    ].join("; "),
  ]);
  const listed = (ids: string[]): Array<[string, string]> =>
    ids.map((id): [string, string] => ["Payment number", id]);
  const sections: StaffEmailSection[] = [
    {
      heading: "Payment notices and status checks in this period",
      rows: activity.length ? activity : [["Recorded", "none"]],
    },
    {
      heading: `Problems in this period: ${digest.problems.total}${digest.problems.total > problems.length ? ` (the ${problems.length} most important are listed)` : ""}`,
      rows: problems.length ? problems : [["Problems", "none"]],
    },
    {
      heading: "Still waiting for staff",
      rows: [
        ["Paid but not activated", `${digest.not_activated.total}`],
        ...listed(digest.not_activated.payment_ids),
        ["Pending with an Ozow request for over 2 hours", `${digest.stale_pending.total}`],
        ...listed(digest.stale_pending.payment_ids),
        ["Problems not emailed yet", `${digest.unalerted}`],
      ],
    },
  ];
  const headline =
    digest.problems.total === 0 && waiting === 0
      ? "no payment problems"
      : `${plural(digest.problems.total, "problem")}, ${waiting} waiting for staff`;
  return {
    to: recipients,
    idempotencyKey: `payment-summary/${digest.day}`,
    subject: `VerifyMzansi payment summary ${digest.day}: ${headline}`,
    title: "Daily payment summary",
    intro: `Payments from ${sast(digest.window_start)} to ${sast(digest.window_end)} (South African time).`,
    sections,
    closing:
      "Problems that need a person are also emailed as soon as they are found. Look a payment up in the staff payments list by its payment number. This email holds no member details.",
    reason: "The VerifyMzansi email job sends this summary once a day to PAYMENT_ALERT_EMAILS.",
    tone: (waiting > 0 || digest.unalerted > 0 ? "warning" : "info") as "warning" | "info",
  };
}

/** One send, never throwing; null when it threw. */
async function attempt(send: () => Promise<SendEmailResult>) {
  try {
    return await send();
  } catch {
    return null;
  }
}

/**
 * The email job's payment step: the alert for new problems, then the daily
 * summary when it is due. Returns the names of the steps that failed (the run
 * is then reported as failed); never throws. Without PAYMENT_ALERT_EMAILS it
 * logs what it would have sent and keeps every payment and email working: the
 * alerts stay unsent (offered again every five minutes for a week), and the
 * day's summary is logged once instead.
 */
export async function runFoundationPaymentAlerts(
  context: PaymentAlertContext,
  options: PaymentAlertOptions = {}
): Promise<string[]> {
  const failed: string[] = [];
  const send = options.send ?? sendStaffOperationsEmail;
  const recipients = (options.recipients ?? paymentAlertRecipients)();

  if (context.canClaim()) {
    const claimed = await context.call(
      "claim_payment_alerts",
      { p_limit: PAYMENT_ALERT_LIMIT },
      context.claimSignal
    );
    const parsed = alertClaimSchema.safeParse(claimed.data);
    if (claimed.error || !parsed.success) failed.push("payment_alert:claim");
    else if (parsed.data.claim && parsed.data.problems.length) {
      const { claim, problems } = parsed.data;
      const listed = problems.map((p) => ({ paymentId: p.payment_id, reason: p.reason }));
      if (!recipients) {
        // Left leased: offered again in five minutes, for a week.
        log.error("Payment alert not emailed: no recipients configured", {
          setting: PAYMENT_ALERT_RECIPIENTS_ENV,
          problems: listed,
        });
      } else if (
        delivered(
          await attempt(() => context.pace(() => send(paymentAlertEmail(recipients, problems))))
        )
      ) {
        const done = await context.call("complete_payment_alerts", { p_claim: claim });
        if (done.error) failed.push("payment_alert:complete");
      } else {
        // Offered again when the lease ends (five minutes).
        failed.push("payment_alert");
        log.error("Payment alert email failed", { problems: listed });
      }
    }
  }

  if (context.canClaim()) {
    const claimed = await context.call(
      "claim_payment_digest",
      { p_from_hour: options.fromHour ?? PAYMENT_SUMMARY_HOUR, p_limit: SUMMARY_LIST_LIMIT },
      context.claimSignal
    );
    const parsed = claimed.data === null ? null : digestSchema.safeParse(claimed.data);
    if (claimed.error || (parsed && !parsed.success)) failed.push("payment_summary:claim");
    else if (parsed?.success) {
      const digest = parsed.data;
      const counts = {
        day: digest.day,
        problems: digest.problems.total,
        notActivated: digest.not_activated.total,
        stalePending: digest.stale_pending.total,
        unalerted: digest.unalerted,
      };
      let done = false;
      if (!recipients) {
        // Logged once a day instead of emailed.
        log.error("Daily payment summary not emailed: no recipients configured", {
          setting: PAYMENT_ALERT_RECIPIENTS_ENV,
          ...counts,
        });
        done = true;
      } else {
        done = delivered(
          await attempt(() => context.pace(() => send(paymentSummaryEmail(recipients, digest))))
        );
        if (!done) {
          failed.push("payment_summary");
          log.error("Daily payment summary email failed", counts);
        }
      }
      if (done) {
        const completed = await context.call("complete_payment_digest", {
          p_claim: digest.claim,
        });
        if (completed.error) failed.push("payment_summary:complete");
      }
    }
  }
  return failed;
}
