import "server-only";
import { z } from "zod";
import { createFoundationServiceApi, type FoundationServiceApi } from "./service-api";
import {
  sendOutboxFinalFailureAlert,
  sendPlatformNotice,
  type PlatformNoticeKind,
  type PostLifecycleDetails,
} from "../services/email";
import { runFoundationPrivacyNotice } from "./privacy-notice-job";
import { runFoundationPaymentAlerts, type PaymentAlertStep } from "./payment-alerts";
import { createLogger } from "../utils/logger";
import { hasDatabaseMessage } from "./error-reasons";

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
]);
type Kind = z.infer<typeof kind>;
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
// The first lost message is reported at once; later ones are collected and
// reported at the end of the email batch, or when this little of the send
// window is left. At most two alert emails go out in one run.
const ALERT_RESERVE_MS = 2_000;
const MAX_ALERTS_PER_RUN = 2;

const SWEEPS = [
  ["run_post_lifecycle", { p_limit: 100 }],
  ["sweep_sponsorships", { p_limit: 100 }],
  ["purge_expired_inbox", { p_limit: 100 }],
  ["reconcile_intro_trials", { p_limit: 20 }],
  ["approve_due_commissions", { p_limit: 20 }],
] as const;

const jobSchema = z
  .object({
    id: z.uuid(),
    kind,
    claim_token: z.uuid(),
    locked_until: z.iso.datetime({ offset: true }),
    attempts: z.number().int().min(1).optional(),
    recipient: z.email().nullable(),
    notice_reason: z.string().min(10).max(500).nullable().optional(),
    deletes_at: z.iso.datetime({ offset: true }).nullable().optional(),
    holds_slot: z.boolean().nullable().optional(),
    // Only for trial_started, from update 20261110045944 on.
    trial_ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
    trial_funds_post: z.boolean().nullable().optional(),
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
type Lost = { id: string; kind: string; maybeDelivered?: boolean };
type StaffAlert = (lost: Lost[]) => Promise<{ success: boolean; outcomeUnknown?: boolean }>;
export interface OperationJobOptions {
  alertStaff?: StaffAlert;
  /** The payment alert and daily payment summary step (./payment-alerts.ts). */
  paymentAlerts?: PaymentAlertStep;
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
  const alertStaff = options.alertStaff ?? sendOutboxFinalFailureAlert;
  const paymentAlerts = options.paymentAlerts ?? ((context) => runFoundationPaymentAlerts(context));
  const deadline = now() + RUN_DEADLINE_MS;
  const failed: string[] = [];
  const summary: OperationJobSummary = { claimed: 0, succeeded: 0, retrying: 0, lost: 0, failed };
  const lost: Lost[] = [];
  const fail = (step: string) => {
    if (!failed.includes(step)) failed.push(step);
  };
  const lose = (id: string, kind: string) => {
    lost.push({ id, kind });
    // Logged at once, so the record survives even if the run is cut off.
    log.error("Queued email reached its last attempt", { kind, id });
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
  const sweeps = (async () => {
    for (const [name, args] of SWEEPS) {
      const result = await call(name, args);
      if (result.error) fail(`sweep:${name}`);
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
  // outcome is recorded, with whether the message is now lost.
  const handle = async (raw: unknown, onSent: (lostNow: boolean) => void) => {
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
    if (job.recipient && (leaseLeft < LEASE_RESERVE_MS || !timeToSend())) {
      // Should not happen with one-at-a-time claims; if it does, give the
      // message back with the usual retry delay rather than send it late.
      const back = await call("complete_notification_outbox", {
        p_id: job.id,
        p_claim: job.claim_token,
        p_ok: false,
        p_error: "deferred",
      });
      if (back.error) fail("outbox:complete");
      return giveUp();
    }
    let success = job.recipient === null;
    // The provider refused a repeat of an earlier request with the same key:
    // that earlier request may have been delivered.
    let unknown = false;
    if (job.recipient) {
      const recipient = job.recipient;
      const key = `foundation-outbox/${job.id}`;
      try {
        const result = await paced(() =>
          job.kind === "account_warning" && job.notice_reason
            ? deliver(recipient, job.kind, key, job.notice_reason)
            : lifecycleKinds.has(job.kind)
              ? deliver(recipient, job.kind, key, undefined, {
                  deletesAt: job.deletes_at ?? null,
                  holdsSlot: job.holds_slot ?? null,
                })
              : job.kind === "trial_started"
                ? deliver(recipient, job.kind, key, undefined, {
                    trialEndsAt: job.trial_ends_at ?? null,
                    trialFundsPost: job.trial_funds_post ?? null,
                  })
                : deliver(recipient, job.kind, key)
        );
        success = result.success;
        unknown = !success && result.outcomeUnknown === true;
      } catch {
        success = false;
      }
      onSent(!success && !unknown && isFinal(job.attempts));
    }
    const done = await call("complete_notification_outbox", {
      p_id: job.id,
      p_claim: job.claim_token,
      p_ok: success,
      p_error: success ? undefined : unknown ? "outcome_unknown" : "delivery_failed",
    });
    // `false` means the lease was lost (retried later); an error means the
    // outcome could not be recorded at all.
    if (done.error) fail("outbox:complete");
    if (done.error || done.data !== true || !success) summary.retrying++;
    else summary.succeeded++;
    if (!isFinal(job.attempts) || success) return;
    if (unknown) {
      // Reported too, marked as possibly delivered.
      lost.push({ id: job.id, kind: job.kind, maybeDelivered: true });
      log.warn("Queued email outcome unknown at its last attempt", { kind: job.kind, id: job.id });
    } else lose(job.id, job.kind);
  };

  let alertsSent = 0;
  let reported = 0;
  const alertDue = () =>
    reported < lost.length &&
    alertsSent < MAX_ALERTS_PER_RUN &&
    (alertsSent === 0 || windowLeft() < ALERT_RESERVE_MS);
  // Sends one alert for the lost messages not yet reported, while a
  // worst-case alert send still fits in the run.
  const alertLost = async () => {
    if (reported >= lost.length || alertsSent >= MAX_ALERTS_PER_RUN || !timeToSend()) return;
    const batch = lost.slice(reported);
    reported = lost.length;
    alertsSent++;
    let alerted = false;
    try {
      const result = await paced(() => alertStaff(batch));
      // A refused repeat of the alert's own request means it was probably sent.
      alerted = result.success || result.outcomeUnknown === true;
    } catch {
      alerted = false;
    }
    if (!alerted) fail("staff_alert");
  };

  const outbox = async (step: string, kinds: () => Kind[], limit: number) => {
    let handled = 0;
    const ahead: { claim: Promise<unknown[] | null> | null } = { claim: null };
    while (handled < limit) {
      if (!ahead.claim && alertDue()) await alertLost();
      const pending = ahead.claim;
      ahead.claim = null;
      const rows = pending ? await pending : timeToClaim() ? await claim(step, kinds()) : null;
      if (!rows?.length) break;
      handled++;
      await handle(rows[0], (lostNow) => {
        // Claim the next message while this outcome is recorded, unless an
        // alert has to go out first.
        if (!lostNow && handled < limit && timeToClaimAhead() && !alertDue())
          ahead.claim = claim(step, kinds());
      });
    }
    return handled;
  };

  const emails = (async () => {
    // Payment messages to members first, then staff payment alerts (at most
    // two sends: new problems, and the daily summary when due), then
    // privacy-request notices (legally timed, rare), then every other kind.
    const payments = await outbox("claim:payment", () => paymentKinds, OUTBOX_RUN_LIMIT);
    // A loss on the last payment slot is reported before anything else.
    if (alertDue()) await alertLost();
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

    await alertLost();
    summary.lost = lost.length;
    // Lost messages that no alert could cover in time stay only in the log
    // and the database.
    if (reported < lost.length) fail("staff_alert");
  })();

  await Promise.all([sweeps, emails]);
  if (failed.length) throw new OperationJobsIncompleteError(failed, summary);
  return summary;
}
