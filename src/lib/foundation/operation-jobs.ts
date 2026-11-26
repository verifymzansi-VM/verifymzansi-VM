import "server-only";
import { z } from "zod";
import { createFoundationServiceApi, type FoundationServiceApi } from "./service-api";
import {
  sendLostEmailAlert,
  sendPlatformNotice,
  sendStaffDeadlineEmail,
  type LostEmailAlert,
  type PlatformNoticeKind,
  type PostLifecycleDetails,
  type StaffDeadlineDetails,
  type StaffDeadlineKind,
} from "../services/email";
import { runFoundationPrivacyNotice } from "./privacy-notice-job";
import { runFoundationPaymentAlerts, type PaymentAlertStep } from "./payment-alerts";
import {
  emailPackageMoveAlert,
  readPackageMoves,
  type PackageMoveAlert,
  type StuckPackageMove,
} from "./package-move-alerts";
import { createLogger } from "../utils/logger";
import { hasDatabaseMessage } from "./error-reasons";
import { paymentNoLongerComplete, readPaymentReceipt } from "./payment-receipt";

const log = createLogger("FoundationOperationJobs");
const kind = z.enum([
  "payment_completed",
  "payment_reversed",
  "payment_reconciliation_required",
  "trial_started",
  "post_expired",
  "post_expiry_reminder",
  "draft_deletion_warning",
  "post_deleted",
  "verification_phone_confirmed",
  "identity_accepted",
  "enquiry_received",
  "account_warning",
  "content_hidden",
  "account_suspended",
  "account_banned",
  "appeal_decided",
  "business_check_update",
  "post_sold",
  "post_kept",
  "verification_returned",
  "slot_renewal_reminder",
  "term_ending_notice",
  "free_credit_reminder",
  "staff_privacy_request",
  "staff_appeal",
  "staff_report",
  "sticker_renewal_reminder",
]);
type Kind = z.infer<typeof kind>;
// Emails to staff about a new privacy request, appeal or report, with its
// deadline (20261125131322_lost_email_alert_staff_deadlines.sql).
const staffKinds: ReadonlySet<Kind> = new Set<Kind>([
  "staff_privacy_request",
  "staff_appeal",
  "staff_report",
]);
const isStaffKind = (k: Kind): k is Kind & StaffDeadlineKind => staffKinds.has(k);
// Payment messages are claimed before every other kind.
const paymentKinds: Kind[] = [
  "payment_completed",
  "payment_reversed",
  "payment_reconciliation_required",
];
const otherKinds = kind.options.filter((k) => !paymentKinds.includes(k));
// Kinds an earlier database does not accept, newest update first: against
// such a database the job drops them one update at a time until the claim is
// accepted, and keeps that list.
const laterKinds: ReadonlyArray<ReadonlySet<Kind>> = [
  // 20261125150215_small_lifecycle_rules.sql
  new Set<Kind>(["sticker_renewal_reminder"]),
  // 20261125131322_lost_email_alert_staff_deadlines.sql
  staffKinds,
  // 20261122182304_free_credit_reminder.sql
  new Set<Kind>(["free_credit_reminder"]),
  // 20261122111209_term_ending_notice.sql
  new Set<Kind>(["term_ending_notice"]),
  // 20261114093742_renew_slots_early.sql
  new Set<Kind>(["slot_renewal_reminder"]),
  // 20261110173012_verification_returned_notice.sql
  new Set<Kind>(["verification_returned"]),
  // 20261109104020_post_expiry_rules.sql
  new Set<Kind>(["post_sold", "post_kept"]),
];
const lifecycleKinds = new Set<Kind>(["post_expired", "post_sold", "post_kept"]);
// That database refuses the longer list for its length or for an unknown
// kind; any other refusal is reported, not retried.
function refusedNewerKinds(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "22023" &&
    (hasDatabaseMessage(error, "supportedMailKindsRequired") ||
      hasDatabaseMessage(error, "unsupportedMailKind"))
  );
}

/** The claim only hands out messages with fewer than eight attempts
 * (`delivery_attempts<8`), so the eighth claim is the last one. */
export const OUTBOX_FINAL_ATTEMPT = 8;
/** Messages sent per run: 100 queued messages go out within five runs. */
export const OUTBOX_RUN_LIMIT = 25;
const PRIVACY_RUN_LIMIT = 5;
// A claim uses up one of a message's eight attempts, and giving a message
// back does not return it. So messages are claimed one at a time, only while
// a worst-case send still fits, and each is sent straight away. The next claim
// runs while the previous outcome is being recorded.
//
// The worker allows 50 s from its own start, which also covers dispatch, cold
// start and middleware before this code runs, so the run aims to end within
// 44 s. Database calls are cut off then. A send (queued email, privacy notice
// or staff alert) starts only while a worst-case send and the record of its
// outcome still fit: three 8-second provider attempts with 1 s and 2 s backoff,
// pacing, and 3 s to record the outcome. That means no new send after 13 s.
const RUN_DEADLINE_MS = 44_000;
const SEND_BUDGET_MS = 31_000;
// A claim starts only with at least twice this much of the send window left
// and is cut off this long before the window closes, so what it returns can
// still be sent.
const CLAIM_MARGIN_MS = 500;
// The part of the send budget allowed for recording an outcome. The next
// claim starts early (while the previous outcome is recorded) only with this
// much more of the send window left, so a slow record cannot push the claimed
// message past the window and cost it an attempt.
const RECORD_ALLOWANCE_MS = 3_000;
// A send needs this much lease left, or another run could claim the message
// while it is still being sent.
const LEASE_RESERVE_MS = SEND_BUDGET_MS;
// The email provider's default limit is two requests a second.
const SEND_SPACING_MS = 500;
// Lost messages (unsent after their last attempt) are found and reported by
// the database (api.claim_lost_email_alert): one alert email a run at most,
// and none within 15 minutes of the last one sent. The alert lists the oldest
// of them, up to this many.
const LOST_ALERT_LIMIT = 50;

const SWEEPS = [
  // Posts move into a renewed slot's next period; renewal reminders are
  // queued (20261114093742_renew_slots_early.sql), and so are term-ending
  // notices and free credit reminders (20261122182304_free_credit_reminder.sql).
  ["run_slot_renewals", { p_limit: 100 }],
  ["run_post_lifecycle", { p_limit: 100 }],
  ["sweep_sponsorships", { p_limit: 100 }],
  ["purge_expired_inbox", { p_limit: 100 }],
  ["reconcile_intro_trials", { p_limit: 20 }],
  ["approve_due_commissions", { p_limit: 20 }],
  // Records the expiry (status, time, audit row) of bank transfers that have
  // waited 14 days; the database treats them as expired already
  // (20261118044440_bank_transfer_expiry.sql).
  // At most 50 rows a run: each is its own subtransaction in the database.
  ["expire_waiting_bank_transfers", { p_limit: 50 }],
  // Voids unpaid added-slots invoices whose package has ended
  // (20261120045404_package_add_slots.sql). Each row is its own subtransaction.
  ["void_ended_package_add_invoices", { p_limit: 50 }],
  // Old view and engaged-view marks, view salts and activity days, and
  // waiting likes that are due (20261121100028_post_performance_stats.sql):
  // its own job, outside the retention sweep.
  ["purge_post_engagement", {}],
] as const;
// Sweeps an earlier database does not have yet: until their update is
// applied, the missing command does not fail the run, but a warning is logged
// (at most once an hour per sweep and worker instance) so it shows in the
// Workers logs instead of passing silently.
const LATER_SWEEPS: ReadonlySet<string> = new Set([
  "expire_waiting_bank_transfers",
  "void_ended_package_add_invoices",
]);
export const MISSING_SWEEP_WARNING_MS = 60 * 60 * 1000;
const missingSweepWarnedAt = new Map<string, number>();
const missingCommand = (error: { code?: string } | null) =>
  error?.code === "PGRST202" || error?.code === "42883";
// A sweep that reports rows it could not change (and, for the bank transfer
// expiry, which rows with their SQLSTATE).
const sweepFailures = z.object({
  failed: z.number().int().min(0),
  failures: z
    .array(z.object({ transfer_id: z.uuid(), sqlstate: z.string().regex(/^[0-9A-Z]{5}$/) }))
    .max(50)
    .optional(),
});

const jobSchema = z
  .object({
    id: z.uuid(),
    kind,
    claim_token: z.uuid(),
    locked_until: z.iso.datetime({ offset: true }),
    attempts: z.number().int().min(1).optional(),
    recipient: z.email().nullable(),
    // For payment_completed: the payment, and the member who paid.
    subject_id: z.uuid().nullable().optional(),
    owner_id: z.uuid().nullable().optional(),
    notice_reason: z.string().min(10).max(500).nullable().optional(),
    deletes_at: z.iso.datetime({ offset: true }).nullable().optional(),
    holds_slot: z.boolean().nullable().optional(),
    // Only for trial_started, from update 20261110045944 on.
    trial_ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
    trial_funds_post: z.boolean().nullable().optional(),
    // Only for slot_renewal_reminder: when the slot ends, and whether more
    // than one slot ends within 7 days (the email links to "Renew all").
    slot_ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
    slot_renew_all: z.boolean().nullable().optional(),
    // Only for term_ending_notice (20261122111209): when the paid term ends,
    // whether it is an Individual slot, a Multi-listing package or other,
    // whether the member can sign in now (false while banned or suspended)
    // and, for an Individual slot, whether the member's Multi-listing package
    // runs past its end (its post then moves into the package).
    term_ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
    term_kind: z.enum(["individual", "package", "other"]).nullable().optional(),
    term_has_access: z.boolean().nullable().optional(),
    term_package_continues: z.boolean().nullable().optional(),
    // Only for free_credit_reminder (20261122182304): when the free credit ends.
    credit_ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
    // Only for the staff deadline emails (20261125131322): the request type,
    // appeal kind or report reason, the report's severity, when it was
    // received and its deadline.
    staff_item_type: z
      .string()
      .regex(/^[a-z_]{1,40}$/)
      .nullable()
      .optional(),
    staff_severity: z.enum(["high", "standard"]).nullable().optional(),
    staff_received_at: z.iso.datetime({ offset: true }).nullable().optional(),
    staff_due_at: z.iso.datetime({ offset: true }).nullable().optional(),
    // Only for sticker_renewal_reminder (20261125150215): which sticker, when
    // it ends and its business.
    sticker_kind: z.enum(["cipc", "seen"]).nullable().optional(),
    sticker_expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
    sticker_business_id: z.uuid().nullable().optional(),
  })
  .refine(
    (job) =>
      job.kind !== "account_warning" ||
      job.recipient === null ||
      typeof job.notice_reason === "string"
  );
type Job = z.infer<typeof jobSchema>;
// Enough of an unreadable message to alert staff about it.
const jobIdentity = z.object({
  id: z.uuid(),
  kind: z.string().regex(/^[a-z_]{1,80}$/),
  attempts: z.number().int().optional(),
});

type Delivery = (
  recipient: string,
  event: PlatformNoticeKind,
  key: string,
  reason?: string,
  details?: PostLifecycleDetails
) => Promise<{ success: boolean; outcomeUnknown?: boolean }>;
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type SendResult = Promise<{ success: boolean; outcomeUnknown?: boolean }>;
type StaffDelivery = (
  recipient: string,
  kind: StaffDeadlineKind,
  key: string,
  details: StaffDeadlineDetails
) => SendResult;
// What api.claim_lost_email_alert returns: an alert (its id, how many lost
// messages it reports, how many of those are payment messages and the oldest
// of them), or no claim. `payments` is missing before update 20261125212548
// and null for an alert made before it.
const lostAlertSchema = z.object({
  claim: z.uuid().nullable(),
  total: z.number().int().min(0),
  payments: z.number().int().min(0).nullish(),
  items: z
    .array(
      z.object({
        source: z.enum(["outbox", "privacy_notice"]),
        id: z.uuid(),
        kind: z.string().regex(/^[a-z_]{1,80}$/),
        attempts: z.number().int().min(0),
        queued_at: z.iso.datetime({ offset: true }),
        last_error: z
          .string()
          .regex(/^[a-z_]{1,80}$/)
          .nullable(),
      })
    )
    .max(LOST_ALERT_LIMIT),
});
export interface OperationJobOptions {
  /** The staff email about lost messages (to the support address by default). */
  lostEmailAlert?: (alert: LostEmailAlert) => SendResult;
  /** The staff deadline email about a new privacy request, appeal or report. */
  deliverStaff?: StaffDelivery;
  /** The payment alert and daily payment summary step (./payment-alerts.ts). */
  paymentAlerts?: PaymentAlertStep;
  /** The staff email about newly stuck package moves (./package-move-alerts.ts). */
  packageMoveAlert?: PackageMoveAlert;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
export interface OperationJobSummary {
  claimed: number;
  succeeded: number;
  retrying: number;
  lost: number;
  failed: string[];
}

/** Thrown after every step has run when at least one step failed, so the
 * worker records the run as failed. `failed` names the steps, nothing more. */
export class OperationJobsIncompleteError extends Error {
  constructor(
    readonly failed: string[],
    readonly summary: OperationJobSummary
  ) {
    super("Some operation jobs failed");
    this.name = "OperationJobsIncompleteError";
  }
}

export async function runFoundationOperationJobs(
  service: FoundationServiceApi = createFoundationServiceApi(),
  deliver: Delivery = sendPlatformNotice,
  options: OperationJobOptions = {}
): Promise<OperationJobSummary> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lostEmailAlert = options.lostEmailAlert ?? sendLostEmailAlert;
  const deliverStaff = options.deliverStaff ?? sendStaffDeadlineEmail;
  const paymentAlerts = options.paymentAlerts ?? ((context) => runFoundationPaymentAlerts(context));
  const packageMoveAlert = options.packageMoveAlert ?? emailPackageMoveAlert;
  const deadline = now() + RUN_DEADLINE_MS;
  const failed: string[] = [];
  const summary: OperationJobSummary = { claimed: 0, succeeded: 0, retrying: 0, lost: 0, failed };
  // Messages lost in this run. The database reports them to staff
  // (lostAlert below, in this run or a later one); they are logged at once.
  let lostCount = 0;
  const fail = (step: string) => {
    if (!failed.includes(step)) failed.push(step);
  };
  const lose = (id: string, kind: string, maybeDelivered = false) => {
    lostCount++;
    if (maybeDelivered) log.warn("Queued email outcome unknown at its last attempt", { kind, id });
    else log.error("Queued email reached its last attempt", { kind, id });
  };
  // Time left before the last moment a send may start.
  const windowLeft = () => deadline - SEND_BUDGET_MS - now();
  const timeToSend = () => windowLeft() >= 0;
  const timeToClaim = () => windowLeft() >= 2 * CLAIM_MARGIN_MS;
  const timeToClaimAhead = () => windowLeft() >= 2 * CLAIM_MARGIN_MS + RECORD_ALLOWANCE_MS;
  const runSignal = () => AbortSignal.timeout(Math.max(1, deadline - now()));
  const claimSignal = () => AbortSignal.timeout(Math.max(1, windowLeft() - CLAIM_MARGIN_MS));
  const call = async (
    name: string,
    args: Record<string, unknown>,
    signal: () => AbortSignal = runSignal
  ): Promise<RpcResult> => {
    try {
      // Typed per command elsewhere; the job only needs data and error.
      const rpc = service.rpc as unknown as (n: string, a: unknown) => PromiseLike<RpcResult>;
      const request = rpc(name, args) as PromiseLike<RpcResult> & {
        abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>;
      };
      return await (typeof request.abortSignal === "function"
        ? request.abortSignal(signal())
        : request);
    } catch {
      return { data: null, error: { message: "request failed" } };
    }
  };

  // Each sweep runs on its own: one failing sweep is reported, the rest and
  // the emails still run. The sweeps run beside the emails so a slow sweep
  // cannot hold up the emails or the staff alert.
  let stuckMoves: StuckPackageMove[] = [];
  const sweeps = (async () => {
    for (const [name, args] of SWEEPS) {
      const result = await call(name, args);
      if (result.error && LATER_SWEEPS.has(name) && missingCommand(result.error)) {
        const at = now();
        if (
          at - (missingSweepWarnedAt.get(name) ?? Number.NEGATIVE_INFINITY) >=
          MISSING_SWEEP_WARNING_MS
        ) {
          missingSweepWarnedAt.set(name, at);
          log.warn("Sweep command missing: its database update is not applied", { sweep: name });
        }
      } else if (result.error) fail(`sweep:${name}`);
      else {
        // Rows a sweep could not change are retried next run; say so.
        const failures = sweepFailures.safeParse(result.data);
        if (failures.success && failures.data.failed > 0)
          log.warn("Sweep left rows it could not change", {
            sweep: name,
            failed: failures.data.failed,
            ...(failures.data.failures ? { rows: failures.data.failures } : {}),
          });
        if (name === "run_slot_renewals") stuckMoves = readPackageMoves(result.data);
      }
    }
    // Each stuck package move is reported once (the database marks it), so
    // staff get one email about it and later runs keep passing. Only a failed
    // email fails this run; the moves stay listed under Needs attention.
    if (stuckMoves.length) {
      let sent = false;
      try {
        sent = (await packageMoveAlert(stuckMoves)).success;
      } catch {
        sent = false;
      }
      if (!sent) {
        log.error("Package move alert not emailed", { moves: stuckMoves });
        fail("package_move_alert");
      }
    }
  })();

  let lastSend = Number.NEGATIVE_INFINITY;
  const paced = async <T>(send: () => Promise<T>) => {
    const wait = lastSend + SEND_SPACING_MS - now();
    if (wait > 0) await sleep(wait);
    lastSend = now();
    return send();
  };

  const isFinal = (attempts: unknown) =>
    typeof attempts === "number" && attempts >= OUTBOX_FINAL_ATTEMPT;

  let otherList: Kind[] = otherKinds;
  // How many of the newest groups of `laterKinds` this run has dropped.
  let dropped = 0;
  const claim = async (step: string, kinds: Kind[]) => {
    const args = (list: Kind[]) => ({ p_limit: 1, p_supported_kinds: list });
    let result = await call("claim_supported_notification_outbox", args(kinds), claimSignal);
    while (kinds === otherList && dropped < laterKinds.length && refusedNewerKinds(result.error)) {
      const newest = laterKinds[dropped++];
      otherList = otherList.filter((k) => !newest.has(k));
      kinds = otherList;
      result = await call("claim_supported_notification_outbox", args(otherList), claimSignal);
    }
    const rows = z.array(z.unknown()).max(1).safeParse(result.data);
    if (result.error || !rows.success) {
      fail(step);
      return null;
    }
    return rows.data;
  };

  // `onSent` runs once a message has been handed to the provider, before its
  // outcome is recorded.
  const handle = async (raw: unknown, onSent: () => void) => {
    summary.claimed++;
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) {
      // Not sent or acknowledged: it is retried after its lease runs out.
      fail("outbox:invalid_message");
      summary.retrying++;
      const identity = jobIdentity.safeParse(raw);
      if (identity.success && isFinal(identity.data.attempts))
        lose(identity.data.id, identity.data.kind);
      return;
    }
    const job: Job = parsed.data;
    const leaseLeft = Date.parse(job.locked_until) - now();
    const giveUp = () => {
      summary.retrying++;
      if (job.recipient && isFinal(job.attempts)) lose(job.id, job.kind);
    };
    // An expired lease may already belong to another run: never send or acknowledge it.
    if (leaseLeft <= 0) return giveUp();
    const giveBack = async (reason: "deferred" | "receipt_unavailable") => {
      const back = await call("complete_notification_outbox", {
        p_id: job.id,
        p_claim: job.claim_token,
        p_ok: false,
        p_error: reason,
      });
      if (back.error) fail("outbox:complete");
      return giveUp();
    };
    const tooLate = () => Date.parse(job.locked_until) - now() < LEASE_RESERVE_MS || !timeToSend();
    // Should not happen with one-at-a-time claims; if it does, give the
    // message back with the usual retry delay rather than send it late.
    if (job.recipient && tooLate()) return giveBack("deferred");
    // A payment receipt shows the details api.get_payment_receipt reads for
    // the payment. The read must end before the last moment a send may start.
    let receiptDetails: PostLifecycleDetails | undefined;
    // A payment refunded or charged back before its receipt went out gets no
    // "Payment received" email at all (the member is told of the reversal).
    let receiptWithdrawn = false;
    if (job.recipient && job.kind === "payment_completed" && job.subject_id) {
      const read = await call("get_payment_receipt", { p_payment_id: job.subject_id }, claimSignal);
      const expected = { paymentId: job.subject_id, ownerId: job.owner_id };
      const receipt = read.error ? null : readPaymentReceipt(read.data, expected);
      if (receipt) receiptDetails = { receipt };
      else if (!read.error && paymentNoLongerComplete(read.data, expected)) {
        receiptWithdrawn = true;
        log.info("Payment no longer complete; receipt not sent", { id: job.id });
      } else {
        fail("outbox:receipt");
        // A failed read is retried while attempts remain. On the last
        // attempt, or when the read does not match the payment, the member
        // still gets the notice, without the payment details.
        if (read.error && !isFinal(job.attempts)) return giveBack("receipt_unavailable");
        log.warn("Payment receipt unavailable; sending the notice without details", {
          id: job.id,
        });
      }
      if (!receiptWithdrawn && tooLate()) return giveBack("deferred");
    }
    // Nothing to send: no recipient, or a receipt no longer due. The message
    // is finished as handled, recorded as skipped so the member's email
    // history does not list it as sent (a database before
    // 20261117123240_skipped_email_status ignores the reason).
    const skipped = job.recipient === null || receiptWithdrawn;
    let success = skipped;
    // The provider refused a repeat of an earlier request with the same key:
    // that earlier request may have been delivered.
    let unknown = false;
    if (job.recipient && !receiptWithdrawn) {
      const recipient = job.recipient;
      const key = `foundation-outbox/${job.id}`;
      try {
        const result = await paced(() =>
          isStaffKind(job.kind)
            ? deliverStaff(recipient, job.kind, key, {
                itemId: job.subject_id ?? "",
                itemType: job.staff_item_type ?? "",
                severity: job.staff_severity ?? null,
                receivedAt: job.staff_received_at ?? "",
                dueAt: job.staff_due_at ?? "",
              })
            : job.kind === "account_warning" && job.notice_reason
              ? deliver(recipient, job.kind, key, job.notice_reason)
              : lifecycleKinds.has(job.kind)
                ? deliver(recipient, job.kind, key, undefined, {
                    deletesAt: job.deletes_at ?? null,
                    holdsSlot: job.holds_slot ?? null,
                  })
                : job.kind === "slot_renewal_reminder" && job.subject_id
                  ? deliver(recipient, job.kind, key, undefined, {
                      slotEndsAt: job.slot_ends_at ?? null,
                      slotRenewAll: job.slot_renew_all ?? null,
                      renewSlotId: job.subject_id,
                    })
                  : job.kind === "term_ending_notice"
                    ? deliver(recipient, job.kind, key, undefined, {
                        termEndsAt: job.term_ends_at ?? null,
                        termKind: job.term_kind ?? null,
                        termHasAccess: job.term_has_access ?? null,
                        termPackageContinues: job.term_package_continues ?? null,
                      })
                    : job.kind === "free_credit_reminder"
                      ? deliver(recipient, job.kind, key, undefined, {
                          creditEndsAt: job.credit_ends_at ?? null,
                        })
                      : job.kind === "sticker_renewal_reminder"
                        ? deliver(recipient, job.kind, key, undefined, {
                            stickerKind: job.sticker_kind ?? null,
                            stickerEndsAt: job.sticker_expires_at ?? null,
                            stickerBusinessId: job.sticker_business_id ?? null,
                          })
                        : job.kind === "trial_started"
                          ? deliver(recipient, job.kind, key, undefined, {
                              trialEndsAt: job.trial_ends_at ?? null,
                              trialFundsPost: job.trial_funds_post ?? null,
                            })
                          : receiptDetails
                            ? deliver(recipient, job.kind, key, undefined, receiptDetails)
                            : deliver(recipient, job.kind, key)
        );
        success = result.success;
        unknown = !success && result.outcomeUnknown === true;
      } catch {
        success = false;
      }
      onSent();
    }
    const done = await call("complete_notification_outbox", {
      p_id: job.id,
      p_claim: job.claim_token,
      p_ok: success,
      p_error: skipped
        ? "skipped"
        : success
          ? undefined
          : unknown
            ? "outcome_unknown"
            : "delivery_failed",
    });
    // `false` means the lease was lost (retried later); an error means the
    // outcome could not be recorded at all.
    if (done.error) fail("outbox:complete");
    if (done.error || done.data !== true || !success) summary.retrying++;
    else summary.succeeded++;
    if (!isFinal(job.attempts) || success) return;
    // Reported too; an unknown outcome is marked as possibly delivered.
    lose(job.id, job.kind, unknown);
  };

  // One alert email about lost messages, from the database: an alert whose
  // send failed is given back and offered again unchanged, under the same key,
  // by the next run. A refused send is logged but does not fail the run: the
  // alert is retried every run until it goes out, so failing it would fail
  // every run (the routine emails included) for as long as its address refuses
  // it. Only a database error fails the run (`lost_email_alert`).
  const lostAlert = async () => {
    if (!timeToClaim() || !timeToSend()) return;
    const claimed = await call(
      "claim_lost_email_alert",
      { p_limit: LOST_ALERT_LIMIT },
      claimSignal
    );
    const alert = lostAlertSchema.safeParse(claimed.data);
    if (claimed.error || !alert.success) return fail("lost_email_alert");
    const { claim: token, total, payments, items } = alert.data;
    if (!token) return;
    let sent = false;
    try {
      const result = await paced(() => lostEmailAlert({ claim: token, total, payments, items }));
      // A refused repeat of the alert's own request means it was probably sent.
      sent = result.success || result.outcomeUnknown === true;
    } catch {
      sent = false;
    }
    const done = await call("complete_lost_email_alert", { p_claim: token, p_sent: sent });
    if (!sent) log.error("Lost email alert not sent", { alert: token, total });
    if (done.error) fail("lost_email_alert");
  };

  const outbox = async (step: string, kinds: () => Kind[], limit: number) => {
    let handled = 0;
    const ahead: { claim: Promise<unknown[] | null> | null } = { claim: null };
    while (handled < limit) {
      const pending = ahead.claim;
      ahead.claim = null;
      const rows = pending ? await pending : timeToClaim() ? await claim(step, kinds()) : null;
      if (!rows?.length) break;
      handled++;
      await handle(rows[0], () => {
        // Claim the next message while this outcome is recorded.
        if (handled < limit && timeToClaimAhead()) ahead.claim = claim(step, kinds());
      });
    }
    return handled;
  };

  const emails = (async () => {
    // Payment messages to members first, then staff payment alerts (at most
    // two sends: new problems, and the daily summary when due), then the
    // lost-email alert (at most one send), then privacy-request notices
    // (legally timed, rare), then every other kind, staff deadline emails
    // included.
    const payments = await outbox("claim:payment", () => paymentKinds, OUTBOX_RUN_LIMIT);
    try {
      for (const step of await paymentAlerts({
        call,
        claimSignal,
        canClaim: () => timeToClaim() && timeToSend(),
        pace: paced,
      }))
        fail(step);
    } catch {
      fail("payment_alert");
    }
    await lostAlert();
    for (let i = 0; i < PRIVACY_RUN_LIMIT && timeToClaim(); i++) {
      let privacy;
      try {
        privacy = await runFoundationPrivacyNotice(service, {
          claimSignal: claimSignal(),
          signal: runSignal(),
          canSend: timeToSend,
          pace: paced,
        });
      } catch {
        fail("privacy_notice");
        break;
      }
      if (privacy === "empty") break;
      summary.claimed++;
      summary[privacy]++;
    }
    await outbox("claim:other", () => otherList, OUTBOX_RUN_LIMIT - payments);
    summary.lost = lostCount;
  })();

  await Promise.all([sweeps, emails]);
  if (failed.length) throw new OperationJobsIncompleteError(failed, summary);
  return summary;
}
