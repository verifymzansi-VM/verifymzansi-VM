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
import { createLogger } from "../utils/logger";

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
]);
type Kind = z.infer<typeof kind>;
// Payment messages are claimed before every other kind.
const paymentKinds: Kind[] = [
  "payment_completed",
  "payment_reversed",
  "payment_reconciliation_required",
];
const otherKinds = kind.options.filter((k) => !paymentKinds.includes(k));
// Kinds a database without update 20261109104020_post_expiry_rules.sql does
// not accept: against such a database the job claims the earlier list.
const laterKinds = new Set<Kind>(["post_sold", "post_kept"]);
const lifecycleKinds = new Set<Kind>(["post_expired", "post_sold", "post_kept"]);
// That database refuses the longer list for its length or for an unknown
// kind; any other refusal is reported, not retried.
function refusedNewerKinds(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "22023" &&
    (error.message === "supported mail kinds required" || error.message === "unsupported mail kind")
  );
}

/** The claim only hands out messages with fewer than eight attempts
 * (`delivery_attempts<8`), so the eighth claim is the last one. */
export const OUTBOX_FINAL_ATTEMPT = 8;
/** Messages sent per run: 100 queued messages go out within five runs. */
export const OUTBOX_RUN_LIMIT = 25;
// Claimed a few at a time so every claimed message is sent well inside its
// 90-second lease; one at a time once a send has been slow.
const CLAIM_CHUNK = 5;
const SLOW_SEND_MS = 3_000;
const PRIVACY_RUN_LIMIT = 5;
// The worker gives up on the request after 50 seconds. Everything here aims to
// finish within 47 s: database calls are cut off at that point. A send
// (outbox, privacy notice or staff alert) starts only while a worst-case send
// and its completion still fit: three 8-second provider attempts with 1 s and
// 2 s backoff, pacing, and 3 s to record the outcome. That means no new send
// after 16 s, and no new claim after 13 s, so what a claim returns can still
// be sent.
const RUN_DEADLINE_MS = 47_000;
const SEND_BUDGET_MS = 31_000;
const CLAIM_BUDGET_MS = 34_000;
// Lost messages are reported as they are found; at most this many alert
// emails go out in one run.
const MAX_ALERTS_PER_RUN = 2;
// A send needs this much lease left, or another run could claim the message
// while it is still being sent.
const LEASE_RESERVE_MS = 30_000;
// The email provider's default limit is two requests a second.
const SEND_SPACING_MS = 500;

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
) => Promise<{ success: boolean }>;
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type StaffAlert = (lost: Array<{ id: string; kind: string }>) => Promise<{ success: boolean }>;
export interface OperationJobOptions {
  alertStaff?: StaffAlert;
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
  const started = now();
  const deadline = started + RUN_DEADLINE_MS;
  const failed: string[] = [];
  const summary: OperationJobSummary = { claimed: 0, succeeded: 0, retrying: 0, lost: 0, failed };
  const lost: Array<{ id: string; kind: string }> = [];
  const fail = (step: string) => {
    if (!failed.includes(step)) failed.push(step);
  };
  const lose = (id: string, kind: string) => {
    lost.push({ id, kind });
    // Logged at once, so the record survives even if the run is cut off.
    log.error("Queued email reached its last attempt", { kind, id });
  };
  const timeToSend = () => deadline - now() >= SEND_BUDGET_MS;
  const timeToClaim = () => deadline - now() >= CLAIM_BUDGET_MS;
  const runSignal = () => AbortSignal.timeout(Math.max(1, deadline - now()));
  const call = async (name: string, args: Record<string, unknown>): Promise<RpcResult> => {
    try {
      // Typed per command elsewhere; the job only needs data and error.
      const rpc = service.rpc as unknown as (n: string, a: unknown) => PromiseLike<RpcResult>;
      const request = rpc(name, args) as PromiseLike<RpcResult> & {
        abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>;
      };
      return await (typeof request.abortSignal === "function"
        ? request.abortSignal(runSignal())
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
  const rowIsFinal = (row: unknown) => isFinal(jobIdentity.safeParse(row).data?.attempts);

  let otherList: Kind[] = otherKinds;
  const claim = async (step: string, kinds: Kind[], limit: number) => {
    let result = await call("claim_supported_notification_outbox", {
      p_limit: limit,
      p_supported_kinds: kinds,
    });
    if (kinds === otherList && refusedNewerKinds(result.error)) {
      otherList = otherKinds.filter((k) => !laterKinds.has(k));
      result = await call("claim_supported_notification_outbox", {
        p_limit: limit,
        p_supported_kinds: otherList,
      });
    }
    const rows = z.array(z.unknown()).max(limit).safeParse(result.data);
    if (result.error || !rows.success) {
      fail(step);
      return null;
    }
    return rows.data;
  };

  let slow = false;
  // Average time to send and record one message in this run, to size claims.
  let rowMs = 0;
  let rowsTimed = 0;
  const handle = async (raw: unknown) => {
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
      // Too late to send safely in this run. Give the message back with the
      // usual retry delay rather than leave it locked.
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
    let sendStarted: number | null = null;
    if (job.recipient) {
      const recipient = job.recipient;
      const key = `foundation-outbox/${job.id}`;
      try {
        success = (
          await paced(() =>
            job.kind === "account_warning" && job.notice_reason
              ? deliver(recipient, job.kind, key, job.notice_reason)
              : lifecycleKinds.has(job.kind)
                ? deliver(recipient, job.kind, key, undefined, {
                    deletesAt: job.deletes_at ?? null,
                    holdsSlot: job.holds_slot ?? null,
                  })
                : deliver(recipient, job.kind, key)
          )
        ).success;
      } catch {
        success = false;
      }
      if (now() - lastSend > SLOW_SEND_MS) slow = true;
      sendStarted = lastSend;
    }
    const done = await call("complete_notification_outbox", {
      p_id: job.id,
      p_claim: job.claim_token,
      p_ok: success,
      p_error: success ? undefined : "delivery_failed",
    });
    // `false` means the lease was lost (retried later); an error means the
    // outcome could not be recorded at all.
    if (done.error) fail("outbox:complete");
    if (sendStarted !== null) {
      rowMs = (rowMs * rowsTimed + (now() - sendStarted)) / (rowsTimed + 1);
      rowsTimed++;
    }
    if (done.error || done.data !== true || !success) summary.retrying++;
    else summary.succeeded++;
    if (!success && isFinal(job.attempts)) lose(job.id, job.kind);
  };

  // Reports lost messages once the last attempts of a claim are done, before
  // any further send, while a worst-case alert send still fits in the run.
  let alertsSent = 0;
  let reported = 0;
  const alertLost = async () => {
    if (reported >= lost.length || alertsSent >= MAX_ALERTS_PER_RUN || !timeToSend()) return;
    const batch = lost.slice(reported);
    reported = lost.length;
    alertsSent++;
    let alerted = false;
    try {
      alerted = (await paced(() => alertStaff(batch))).success;
    } catch {
      alerted = false;
    }
    if (!alerted) fail("staff_alert");
  };

  const outbox = async (step: string, kinds: () => Kind[], limit: number) => {
    let handled = 0;
    while (handled < limit && timeToClaim()) {
      // Claim only what can still be sent before the send cutoff at the
      // speed seen so far, so claimed messages are not deferred.
      const fits = rowsTimed
        ? Math.floor((deadline - SEND_BUDGET_MS - now()) / Math.max(rowMs, SEND_SPACING_MS))
        : CLAIM_CHUNK;
      const want = Math.min(slow ? 1 : CLAIM_CHUNK, fits, limit - handled);
      if (want < 1) break;
      const rows = await claim(step, kinds(), want);
      if (rows === null) break;
      // Last attempts first, so time running out never costs a message its
      // last try, and the alert for any of them goes out before the rest.
      const finals = rows.filter(rowIsFinal);
      for (const raw of finals) await handle(raw);
      await alertLost();
      for (const raw of rows.filter((row) => !rowIsFinal(row))) await handle(raw);
      handled += rows.length;
      if (rows.length < want) break;
    }
    return handled;
  };

  const emails = (async () => {
    // Payment messages first, then privacy-request notices (legally timed,
    // rare), then every other kind.
    const payments = await outbox("claim:payment", () => paymentKinds, OUTBOX_RUN_LIMIT);
    for (let i = 0; i < PRIVACY_RUN_LIMIT && timeToClaim(); i++) {
      let privacy;
      try {
        privacy = await paced(() =>
          runFoundationPrivacyNotice(service, { signal: runSignal(), canSend: timeToSend })
        );
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
    // Lost messages that no alert could cover in time stay only in the log.
    if (reported < lost.length) fail("staff_alert");
  })();

  await Promise.all([sweeps, emails]);
  if (failed.length) throw new OperationJobsIncompleteError(failed, summary);
  return summary;
}
