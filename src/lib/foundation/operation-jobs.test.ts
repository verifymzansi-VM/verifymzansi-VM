/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import {
  OperationJobsIncompleteError,
  OUTBOX_FINAL_ATTEMPT,
  OUTBOX_RUN_LIMIT,
  runFoundationOperationJobs,
} from "./operation-jobs";
import { runFoundationPrivacyNotice, type PrivacyNoticeRun } from "./privacy-notice-job";
vi.mock("server-only", () => ({}));
vi.mock("../services/email", () => ({
  sendPlatformNotice: vi.fn(),
  sendOutboxFinalFailureAlert: vi.fn(),
  sendStaffOperationsEmail: vi.fn(),
}));
vi.mock("./privacy-notice-job", () => ({ runFoundationPrivacyNotice: vi.fn(async () => "empty") }));
const privacy = vi.mocked(runFoundationPrivacyNotice);
const id = "00000000-0000-4000-8000-000000000001";
const claim = "00000000-0000-4000-8000-000000000002";
const rpc = vi.fn(),
  deliver = vi.fn(),
  alertStaff = vi.fn(),
  // The payment alert step has its own tests (payment-alerts.test.ts); here
  // it is a stand-in unless a test says otherwise.
  paymentAlerts = vi.fn();
const service = { rpc } as unknown as FoundationServiceApi;
const SWEEPS = [
  "run_post_lifecycle",
  "sweep_sponsorships",
  "purge_expired_inbox",
  "reconcile_intro_trials",
  "approve_due_commissions",
];
const PAYMENT = ["payment_completed", "payment_reversed", "payment_reconciliation_required"];
const job = (extra: Record<string, unknown> = {}) => ({
  id,
  claim_token: claim,
  locked_until: new Date(Date.now() + 90000).toISOString(),
  attempts: 1,
  recipient: "synthetic@example.invalid",
  kind: "payment_completed",
  ...extra,
});
// Hands out the given jobs once, to the first claim whose kinds include them.
function queue(...items: Array<Record<string, unknown>>) {
  const left = [...items];
  rpc.mockImplementation(async (name, args) => {
    if (name === "claim_supported_notification_outbox") {
      const out = [];
      for (const item of [...left]) {
        if (out.length >= args.p_limit) break;
        if (!args.p_supported_kinds.includes(item.kind)) continue;
        left.splice(left.indexOf(item), 1);
        out.push(item);
      }
      return { data: out, error: null };
    }
    return { data: name === "complete_notification_outbox" ? true : {}, error: null };
  });
}
const run = (options = {}) =>
  runFoundationOperationJobs(service, deliver, {
    alertStaff,
    paymentAlerts,
    sleep: async () => {},
    ...options,
  });
const calls = (name: string) => rpc.mock.calls.filter(([n]) => n === name);
beforeEach(() => {
  vi.clearAllMocks();
  privacy.mockResolvedValue("empty");
  deliver.mockResolvedValue({ success: true });
  alertStaff.mockResolvedValue({ success: true });
  paymentAlerts.mockResolvedValue([]);
  queue(job());
});

it("runs every sweep and acknowledges only the claimed event", async () => {
  expect(await run()).toEqual({ claimed: 1, succeeded: 1, retrying: 0, lost: 0, failed: [] });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "payment_completed",
    `foundation-outbox/${id}`
  );
  expect(rpc).toHaveBeenCalledWith("complete_notification_outbox", {
    p_id: id,
    p_claim: claim,
    p_ok: true,
    p_error: undefined,
  });
  expect(rpc.mock.calls.map(([name]) => name).filter((n) => SWEEPS.includes(n))).toEqual(SWEEPS);
  expect(alertStaff).not.toHaveBeenCalled();
});

describe("independent steps", () => {
  it("runs the other sweeps, the emails and privacy notices when sweeps fail, then fails the run", async () => {
    queue(job());
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) => {
      if (name === "sweep_sponsorships") throw new Error("PRIVATE_NETWORK_DETAIL");
      if (name === "purge_expired_inbox") return { data: null, error: { code: "XX000" } };
      return base(name, args);
    });
    const error = await run().catch((e) => e);
    expect(error).toBeInstanceOf(OperationJobsIncompleteError);
    expect(error.failed).toEqual(["sweep:sweep_sponsorships", "sweep:purge_expired_inbox"]);
    expect(error.message).not.toContain("PRIVATE");
    expect(error.summary).toMatchObject({ claimed: 1, succeeded: 1 });
    for (const name of SWEEPS) expect(calls(name)).toHaveLength(1);
    expect(deliver).toHaveBeenCalledOnce();
    expect(privacy).toHaveBeenCalled();
  });

  it("does not wait for a slow sweep before sending emails", async () => {
    queue(job());
    const base = rpc.getMockImplementation()!;
    let releaseSweep!: () => void;
    rpc.mockImplementation(async (name, args) => {
      if (name === "run_post_lifecycle") {
        await new Promise<void>((r) => (releaseSweep = r));
        return { data: {}, error: null };
      }
      return base(name, args);
    });
    const pending = run();
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce());
    expect(calls("sweep_sponsorships")).toHaveLength(0);
    releaseSweep();
    await expect(pending).resolves.toMatchObject({ succeeded: 1 });
    expect(calls("approve_due_commissions")).toHaveLength(1);
  });

  it("still runs sweeps and privacy notices when the email claim fails", async () => {
    rpc.mockImplementation(async (name) =>
      name === "claim_supported_notification_outbox"
        ? { data: null, error: { code: "42501", message: "denied" } }
        : { data: {}, error: null }
    );
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["claim:payment", "claim:other"]);
    for (const name of SWEEPS) expect(calls(name)).toHaveLength(1);
    expect(privacy).toHaveBeenCalledOnce();
    expect(calls("claim_supported_notification_outbox")).toHaveLength(2);
  });

  it("still sends the emails when the privacy notice step fails", async () => {
    privacy.mockRejectedValue(new Error("Privacy notice claim failed"));
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["privacy_notice"]);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("skips an unreadable message but sends the rest of the batch", async () => {
    const other = "00000000-0000-4000-8000-000000000003";
    queue({ ...job(), kind: "account_warning" }, job({ id: other, kind: "payment_reversed" }));
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["outbox:invalid_message"]);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      "synthetic@example.invalid",
      "payment_reversed",
      `foundation-outbox/${other}`
    );
    expect(calls("complete_notification_outbox").map(([, a]) => a.p_id)).toEqual([other]);
  });
});

// An outbox that behaves like the database: a claim uses up one attempt and
// takes a 90-second lease, only messages with fewer than eight attempts are
// handed out, and a completion clears the lease and sets the retry delay.
type Row = {
  id: string;
  kind: string;
  attempts: number;
  due: number;
  lease: number;
  token: string;
  done: boolean;
  errors: string[];
};
function world(
  clock: { t: number },
  items: Array<{ id: string; kind: string; attempts?: number }>,
  rpcMs = 0
) {
  const rows: Row[] = items.map((item) => ({
    ...item,
    attempts: item.attempts ?? 0,
    due: 0,
    lease: 0,
    token: "",
    done: false,
    errors: [],
  }));
  let tokens = 0;
  rpc.mockImplementation(async (name, args) => {
    // Calls that overlap share the time: each ends rpcMs after it began.
    if (!SWEEPS.includes(name) && rpcMs) {
      const begun = clock.t;
      await Promise.resolve();
      clock.t = Math.max(clock.t, begun + rpcMs);
    }
    if (name === "claim_supported_notification_outbox") {
      const out = [];
      for (const row of rows) {
        if (out.length >= args.p_limit) break;
        if (row.done || row.attempts >= OUTBOX_FINAL_ATTEMPT || row.due > clock.t) continue;
        if (row.lease > clock.t || !args.p_supported_kinds.includes(row.kind)) continue;
        row.attempts++;
        row.lease = clock.t + 90_000;
        row.token = `00000000-0000-4000-9000-${String(++tokens).padStart(12, "0")}`;
        out.push({
          id: row.id,
          kind: row.kind,
          claim_token: row.token,
          locked_until: new Date(row.lease).toISOString(),
          attempts: row.attempts,
          recipient: "synthetic@example.invalid",
        });
      }
      return { data: out, error: null };
    }
    if (name === "complete_notification_outbox") {
      const row = rows.find((r) => r.id === args.p_id);
      if (!row || row.token !== args.p_claim || row.done || row.lease <= clock.t)
        return { data: false, error: null };
      row.done = args.p_ok;
      row.token = "";
      row.lease = 0;
      if (!args.p_ok) row.errors.push(args.p_error);
      row.due = clock.t + Math.min(21_600, 30 * 2 ** Math.min(row.attempts, 9)) * 1000;
      return { data: true, error: null };
    }
    return { data: {}, error: null };
  });
  return rows;
}
const uuids = (n: number, from = 0) =>
  Array.from(
    { length: n },
    (_, i) => `00000000-0000-4000-8000-${String(from + i).padStart(12, "0")}`
  );
const start = () => ({ t: Date.parse("2026-11-10T08:00:00Z") });
// Each send takes `sendMs` on the run's clock; pacing waits move the clock too.
function timed(clock: { t: number }, sendMs: number, success = true) {
  deliver.mockImplementation(async () => {
    clock.t += sendMs;
    return { success };
  });
  return { now: () => clock.t, sleep: async (ms: number) => void (clock.t += ms) };
}
const deferred = (rows: Row[]) => rows.flatMap((r) => r.errors).filter((e) => e === "deferred");

describe("batch size, order and time limit", () => {
  it("sends 100 queued messages within five runs, payment messages first", async () => {
    const clock = start();
    // Oldest first in the queue; the ten payment messages were queued last.
    const rows = world(clock, [
      ...uuids(90, 100).map((id) => ({ id, kind: "post_expiry_reminder" })),
      ...uuids(10, 900).map((id) => ({ id, kind: "payment_completed" })),
    ]);
    const options = timed(clock, 0);
    const perRun: number[] = [];
    for (let r = 0; r < 5; r++) {
      const before = deliver.mock.calls.length;
      await run(options);
      perRun.push(deliver.mock.calls.length - before);
      clock.t += 60_000;
    }
    expect(perRun).toEqual([25, 25, 25, 25, 0]);
    expect(rows.every((r) => r.done && r.attempts === 1)).toBe(true);
    expect(deliver.mock.calls.slice(0, 10).map(([, kind]) => kind)).toEqual(
      Array(10).fill("payment_completed")
    );
    expect(OUTBOX_RUN_LIMIT).toBeGreaterThanOrEqual(20);
  });

  it("sends 100 queued messages within five runs at realistic speeds", async () => {
    // 150 ms per database call, 400 ms per send, real pacing.
    const clock = start();
    const rows = world(
      clock,
      uuids(100, 100).map((id) => ({ id, kind: "post_expiry_reminder" })),
      150
    );
    const options = timed(clock, 400);
    let longest = 0;
    for (let r = 0; r < 5; r++) {
      const begun = clock.t;
      await run(options);
      longest = Math.max(longest, clock.t - begun);
      clock.t += 60_000;
    }
    expect(rows.filter((r) => r.done)).toHaveLength(100);
    expect(rows.every((r) => r.attempts === 1)).toBe(true);
    expect(longest).toBeLessThan(44_000);
  });

  it("with a slow provider, sends every message it claims and wastes no attempt", async () => {
    // A 9-second provider: the first try times out at 8 s.
    const clock = start();
    const rows = world(
      clock,
      uuids(10, 100).map((id) => ({ id, kind: "payment_completed" })),
      150
    );
    await run(timed(clock, 9_000));
    const claimed = rows.filter((r) => r.attempts > 0);
    expect(claimed.length).toBe(deliver.mock.calls.length);
    expect(claimed.every((r) => r.done)).toBe(true);
    expect(deferred(rows)).toEqual([]);
    expect(deliver.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("claims one message at a time, payment kinds before the others", async () => {
    const clock = start();
    world(clock, [
      ...uuids(3, 100).map((id) => ({ id, kind: "enquiry_received" })),
      ...uuids(2, 900).map((id) => ({ id, kind: "payment_reversed" })),
    ]);
    await run(timed(clock, 0));
    const claims = calls("claim_supported_notification_outbox").map(([, a]) => ({
      limit: a.p_limit,
      payment: a.p_supported_kinds.every((k: string) => PAYMENT.includes(k)),
    }));
    expect(claims).toEqual([
      ...Array(3).fill({ limit: 1, payment: true }),
      ...Array(4).fill({ limit: 1, payment: false }),
    ]);
    expect(deliver.mock.calls.map(([, kind]) => kind)).toEqual([
      "payment_reversed",
      "payment_reversed",
      "enquiry_received",
      "enquiry_received",
      "enquiry_received",
    ]);
  });

  it("claims the next message while the previous outcome is recorded", async () => {
    const clock = start();
    world(
      clock,
      uuids(2, 100).map((id) => ({ id, kind: "payment_completed" })),
      150
    );
    const order: string[] = [];
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) => {
      if (!SWEEPS.includes(name)) order.push(`${name}:start`);
      const result = await base(name, args);
      if (!SWEEPS.includes(name)) order.push(`${name}:end`);
      return result;
    });
    await run(timed(clock, 0));
    expect(order.slice(2, 6)).toEqual([
      "claim_supported_notification_outbox:start",
      "complete_notification_outbox:start",
      "claim_supported_notification_outbox:end",
      "complete_notification_outbox:end",
    ]);
  });

  it("paces sends to the provider's rate", async () => {
    const clock = start();
    world(
      clock,
      uuids(3, 100).map((id) => ({ id, kind: "payment_completed" }))
    );
    const options = timed(clock, 0);
    const sleep = vi.fn(options.sleep);
    await run({ ...options, sleep });
    expect(sleep.mock.calls).toEqual([[500], [500]]);
  });

  it("stops claiming once a worst-case send would no longer fit", async () => {
    const clock = start();
    const rows = world(
      clock,
      uuids(30, 100).map((id) => ({ id, kind: "post_expiry_reminder" }))
    );
    await run(timed(clock, 4_000));
    // Sends start at 0, 4, 8 and 12 s; none may start after 13 s.
    expect(deliver).toHaveBeenCalledTimes(4);
    expect(rows.filter((r) => r.attempts > 0)).toHaveLength(4);
    expect(deferred(rows)).toEqual([]);
  });

  it("does not send a message whose lease is too short to finish safely", async () => {
    queue(job({ locked_until: new Date(Date.now() + 10_000).toISOString() }));
    expect(await run()).toMatchObject({ claimed: 1, succeeded: 0, retrying: 1 });
    expect(deliver).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("complete_notification_outbox", {
      p_id: id,
      p_claim: claim,
      p_ok: false,
      p_error: "deferred",
    });
  });

  it("sends up to five privacy notices a run while time allows", async () => {
    queue();
    privacy.mockResolvedValue("succeeded");
    expect(await run()).toMatchObject({ claimed: 5, succeeded: 5 });
    expect(privacy).toHaveBeenCalledTimes(5);
  });

  it("starts no claim, privacy notice or send once a worst-case send no longer fits", async () => {
    privacy.mockResolvedValue("succeeded");
    let clock = 0;
    const now = () => (clock += 18_000);
    await run({ now });
    expect(privacy).not.toHaveBeenCalled();
    expect(calls("claim_supported_notification_outbox")).toHaveLength(0);
    for (const name of SWEEPS) expect(calls(name)).toHaveLength(1);
  });

  it("passes the run's time limits and pacing to the privacy notice step", async () => {
    const clock = start();
    let seen: PrivacyNoticeRun = {};
    privacy.mockImplementation(async (_service, limits = {}) => {
      seen = limits;
      return "empty";
    });
    queue();
    await run({ now: () => clock.t });
    expect(seen.claimSignal).toBeInstanceOf(AbortSignal);
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(typeof seen.pace).toBe("function");
    expect(seen.canSend?.()).toBe(true);
    clock.t += 14_000;
    expect(seen.canSend?.()).toBe(false);
  });

  it("does not claim other kinds when what a claim returns could no longer be sent", async () => {
    const clock = start();
    privacy.mockImplementation(async () => {
      clock.t += 12_500;
      return "empty";
    });
    queue();
    await run({ now: () => clock.t });
    const others = calls("claim_supported_notification_outbox").filter(
      ([, a]) => !a.p_supported_kinds.every((k: string) => PAYMENT.includes(k))
    );
    expect(others).toHaveLength(0);
  });

  it("fails the run when an outcome cannot be recorded", async () => {
    queue(job());
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "complete_notification_outbox"
        ? { data: null, error: { code: "PGRST202" } }
        : base(name, args)
    );
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["outbox:complete"]);
    expect(error.summary).toMatchObject({ claimed: 1, succeeded: 0, retrying: 1 });
  });

  it("passes the run's time limit to database calls that accept one", async () => {
    const signals: AbortSignal[] = [];
    rpc.mockImplementation((name) => ({
      abortSignal: async (signal: AbortSignal) => {
        signals.push(signal);
        return { data: name === "claim_supported_notification_outbox" ? [] : {}, error: null };
      },
    }));
    await run();
    expect(signals.length).toBe(SWEEPS.length + 2);
    for (const signal of signals) expect(signal.aborted).toBe(false);
  });

  it("records an unknown outcome and retries it", async () => {
    queue(job({ attempts: 3 }));
    deliver.mockResolvedValue({ success: false, outcomeUnknown: true });
    expect(await run()).toMatchObject({ retrying: 1, lost: 0, failed: [] });
    expect(alertStaff).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("complete_notification_outbox", {
      p_id: id,
      p_claim: claim,
      p_ok: false,
      p_error: "outcome_unknown",
    });
  });

  it("reports a last-attempt unknown outcome as possibly delivered", async () => {
    queue(job({ attempts: OUTBOX_FINAL_ATTEMPT }));
    deliver.mockResolvedValue({ success: false, outcomeUnknown: true });
    expect(await run()).toMatchObject({ retrying: 1, failed: [] });
    expect(alertStaff).toHaveBeenCalledExactlyOnceWith([
      { id, kind: "payment_completed", maybeDelivered: true },
    ]);
  });

  it("claims the next message early only while a slow record cannot push it past the window", async () => {
    // A takes 11.5 s to send and 1.5 s to record; B and C are on their last attempt.
    const clock = start();
    const rows = world(
      clock,
      uuids(3, 100).map((id) => ({ id, kind: "payment_completed", attempts: 7 })),
      150
    );
    const base = rpc.getMockImplementation()!;
    let records = 0;
    rpc.mockImplementation(async (name, args) => {
      if (name === "complete_notification_outbox" && ++records === 1) clock.t += 1_350;
      return base(name, args);
    });
    expect(await run(timed(clock, 11_500))).toMatchObject({ succeeded: 1, lost: 0, failed: [] });
    expect(rows.map((r) => r.attempts)).toEqual([8, 7, 7]);
    expect(deferred(rows)).toEqual([]);
    expect(alertStaff).not.toHaveBeenCalled();
  });
});

describe("last attempt", () => {
  const last = { attempts: OUTBOX_FINAL_ATTEMPT };

  it("alerts staff once, without the recipient, when a message fails its last attempt", async () => {
    queue(job(last));
    deliver.mockResolvedValue({ success: false });
    expect(await run()).toMatchObject({ retrying: 1, lost: 1, failed: [] });
    expect(alertStaff).toHaveBeenCalledExactlyOnceWith([{ id, kind: "payment_completed" }]);
    expect(JSON.stringify(alertStaff.mock.calls)).not.toContain("synthetic@example.invalid");
  });

  it("reports the first loss at once and collects later ones into one more alert", async () => {
    const clock = start();
    const lostIds = uuids(4, 100);
    world(
      clock,
      lostIds.map((id) => ({ id, kind: "payment_completed", attempts: 7 }))
    );
    expect(await run(timed(clock, 0, false))).toMatchObject({ lost: 4, failed: [] });
    expect(alertStaff).toHaveBeenCalledTimes(2);
    expect(alertStaff.mock.calls[0][0]).toEqual([{ id: lostIds[0], kind: "payment_completed" }]);
    expect(alertStaff.mock.calls[1][0].map((l: { id: string }) => l.id)).toEqual(lostIds.slice(1));
  });

  it("sends at most two alerts a run and reports the rest as a failed alert", async () => {
    const clock = start();
    world(
      clock,
      uuids(10, 100).map((id) => ({ id, kind: "payment_completed", attempts: 7 }))
    );
    // Each failed send takes 2.2 s. Alert 1 goes out at 2.2 s; alert 2 once
    // under 2 s of the send window is left (11.5 s); the message sent after
    // it (from 12 s) is not covered by any alert.
    const error = await run(timed(clock, 2_200, false)).catch((e) => e);
    expect(alertStaff.mock.calls.map(([batch]) => batch.length)).toEqual([1, 4]);
    expect(error.failed).toEqual(["staff_alert"]);
    expect(error.summary.lost).toBe(6);
  });

  it("alerts before sending any further message", async () => {
    const other = "00000000-0000-4000-8000-000000000003";
    queue(job(last), job({ id: other, attempts: 2 }));
    let clock = 1_000_000;
    const order: string[] = [];
    deliver.mockImplementation(async (_to, _kind, key) => {
      order.push(key);
      if (key.endsWith(other)) clock += 27_000;
      return { success: !key.endsWith(id) };
    });
    alertStaff.mockImplementation(async () => {
      order.push("alert");
      return { success: true };
    });
    expect(await run({ now: () => clock })).toMatchObject({ lost: 1, failed: [] });
    expect(order).toEqual([`foundation-outbox/${id}`, "alert", `foundation-outbox/${other}`]);
  });

  it("reports a loss on the last payment slot before the privacy notices", async () => {
    const clock = start();
    const all = uuids(OUTBOX_RUN_LIMIT, 100);
    world(
      clock,
      all.map((id, i) => ({
        id,
        kind: "payment_completed",
        attempts: i === OUTBOX_RUN_LIMIT - 1 ? 7 : 0,
      }))
    );
    deliver.mockImplementation(async (_to, _kind, key) => ({
      success: !key.endsWith(all[OUTBOX_RUN_LIMIT - 1]),
    }));
    const order: string[] = [];
    alertStaff.mockImplementation(async () => {
      order.push("alert");
      return { success: true };
    });
    privacy.mockImplementation(async () => {
      order.push("privacy");
      return "empty";
    });
    await run({ now: () => clock.t });
    expect(order).toEqual(["alert", "privacy"]);
  });

  it("counts an alert refused as a repeat of its own request as sent", async () => {
    queue(job(last));
    deliver.mockResolvedValue({ success: false });
    alertStaff.mockResolvedValue({ success: false, outcomeUnknown: true });
    expect(await run()).toMatchObject({ lost: 1, failed: [] });
  });

  it("does not start an alert that a worst-case send no longer fits", async () => {
    queue(job(last));
    let clock = 1_000_000;
    deliver.mockImplementation(async () => {
      clock += 20_000;
      return { success: false };
    });
    const error = await run({ now: () => clock }).catch((e) => e);
    expect(alertStaff).not.toHaveBeenCalled();
    expect(error.failed).toEqual(["staff_alert"]);
    expect(error.summary.lost).toBe(1);
  });

  it("alerts when a last-attempt message cannot be sent in time", async () => {
    queue(job({ ...last, locked_until: new Date(Date.now() + 5_000).toISOString() }));
    await run();
    expect(deliver).not.toHaveBeenCalled();
    expect(alertStaff).toHaveBeenCalledOnce();
  });

  it("alerts for an unreadable message at its last attempt", async () => {
    queue({ ...job(last), kind: "account_warning" });
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["outbox:invalid_message"]);
    expect(alertStaff).toHaveBeenCalledExactlyOnceWith([{ id, kind: "account_warning" }]);
  });

  it("does not alert for an earlier failed attempt or a delivered last attempt", async () => {
    queue(job({ attempts: OUTBOX_FINAL_ATTEMPT - 1 }));
    deliver.mockResolvedValue({ success: false });
    await run();
    queue(job(last));
    deliver.mockResolvedValue({ success: true });
    await run();
    expect(alertStaff).not.toHaveBeenCalled();
  });

  it("uses the support-address alert email by default", async () => {
    const { sendOutboxFinalFailureAlert } = await import("../services/email");
    vi.mocked(sendOutboxFinalFailureAlert).mockResolvedValue({ success: true });
    queue(job(last));
    deliver.mockResolvedValue({ success: false });
    await runFoundationOperationJobs(service, deliver, { paymentAlerts, sleep: async () => {} });
    expect(sendOutboxFinalFailureAlert).toHaveBeenCalledExactlyOnceWith([
      { id, kind: "payment_completed" },
    ]);
  });

  it("sends the alert without waiting for a slow sweep", async () => {
    queue(job(last));
    deliver.mockResolvedValue({ success: false });
    const base = rpc.getMockImplementation()!;
    let releaseSweep!: () => void;
    rpc.mockImplementation(async (name, args) => {
      if (name === "run_post_lifecycle") {
        await new Promise<void>((r) => (releaseSweep = r));
        return { data: {}, error: null };
      }
      return base(name, args);
    });
    const pending = run();
    await vi.waitFor(() => expect(alertStaff).toHaveBeenCalledOnce());
    releaseSweep();
    await expect(pending).resolves.toMatchObject({ lost: 1 });
  });

  it("fails the run when the staff alert itself cannot be sent", async () => {
    queue(job(last));
    deliver.mockResolvedValue({ success: false });
    alertStaff.mockRejectedValue(new Error("provider down"));
    const error = await run().catch((e) => e);
    expect(error).toBeInstanceOf(OperationJobsIncompleteError);
    expect(error.failed).toEqual(["staff_alert"]);
    expect(error.summary.lost).toBe(1);
  });

  it("matches the database's attempt limit and lease", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "database/foundation/current/functions/internal/claim_supported_notification_outbox.sql"
      ),
      "utf8"
    );
    expect(sql).toContain(`delivery_attempts<${OUTBOX_FINAL_ATTEMPT} `);
    expect(sql).toContain("'attempts',o.delivery_attempts");
    expect(sql).toContain("interval '90 seconds'");
    expect(sql).toContain("p_limit not between 1 and 50");
  });
});

it("does not send or acknowledge an expired lease", async () => {
  queue(job({ locked_until: "2000-01-01T00:00:00Z" }));
  expect(await run()).toMatchObject({ claimed: 1, succeeded: 0, retrying: 1 });
  expect(deliver).not.toHaveBeenCalled();
  expect(calls("complete_notification_outbox")).toHaveLength(0);
});
it("records only a safe retry reason when provider delivery fails", async () => {
  deliver.mockRejectedValue(new Error("PRIVATE_PROVIDER_RESPONSE"));
  expect(await run()).toMatchObject({ claimed: 1, succeeded: 0, retrying: 1, lost: 0 });
  expect(rpc).toHaveBeenCalledWith("complete_notification_outbox", {
    p_id: id,
    p_claim: claim,
    p_ok: false,
    p_error: "delivery_failed",
  });
});
it("claims only declared supported kinds and passes the owner warning reason to delivery", async () => {
  queue(job({ kind: "account_warning", notice_reason: "Actual independent warning reason" }));
  expect(await run()).toMatchObject({ succeeded: 1 });
  const kinds = calls("claim_supported_notification_outbox").flatMap(
    ([, a]) => a.p_supported_kinds
  );
  expect(kinds).toEqual(
    expect.arrayContaining(["account_warning", "enquiry_received", ...PAYMENT])
  );
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "account_warning",
    `foundation-outbox/${id}`,
    "Actual independent warning reason"
  );
});
it("refuses a warning with missing details before sending or acknowledging it", async () => {
  queue(job({ kind: "account_warning" }));
  await expect(run()).rejects.toThrow();
  expect(deliver).not.toHaveBeenCalled();
  expect(calls("complete_notification_outbox")).toHaveLength(0);
});
it("acknowledges a removed recipient without sending a warning or requiring erased details", async () => {
  queue(job({ kind: "account_warning", recipient: null, notice_reason: null }));
  expect(await run()).toMatchObject({ succeeded: 1 });
  expect(deliver).not.toHaveBeenCalled();
});
it("declares and delivers the sold-post notice within the database's kind limit", async () => {
  queue(job({ kind: "post_sold" }));
  expect(await run()).toMatchObject({ succeeded: 1 });
  const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
  expect(lists.flat()).toEqual(expect.arrayContaining(["post_sold", "post_kept"]));
  expect(new Set(lists.flat()).size).toBe(20);
  for (const list of lists) expect(list.length).toBeLessThanOrEqual(20);
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "post_sold",
    `foundation-outbox/${id}`,
    undefined,
    { deletesAt: null, holdsSlot: null }
  );
});
it("sends the ID-returned notice with nothing but its kind", async () => {
  queue(job({ kind: "verification_returned" }));
  expect(await run()).toMatchObject({ succeeded: 1 });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "verification_returned",
    `foundation-outbox/${id}`
  );
});
it("passes the deletion date and slot of a lifecycle notice to the email", async () => {
  queue(job({ kind: "post_expired", deletes_at: "2026-11-12T08:30:00+00:00", holds_slot: false }));
  expect(await run()).toMatchObject({ succeeded: 1 });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "post_expired",
    `foundation-outbox/${id}`,
    undefined,
    { deletesAt: "2026-11-12T08:30:00+00:00", holdsSlot: false }
  );
});
describe("a database without the newer kinds", () => {
  const refuse = (message: string) => {
    queue(job({ kind: "enquiry_received" }));
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "claim_supported_notification_outbox" && args.p_supported_kinds.includes("post_sold")
        ? { data: null, error: { code: "22023", message } }
        : base(name, args)
    );
  };
  it("claims the earlier kinds after an unknown-kind refusal", async () => {
    refuse("unsupported mail kind");
    expect(await run()).toMatchObject({ succeeded: 1 });
    const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
    // The newest kind is dropped first, then the sold and kept notices.
    expect(lists.map((l) => l.length)).toEqual([3, 17, 16, 14, 14]);
    expect(lists[2]).not.toContain("verification_returned");
    expect(lists[2]).toContain("post_sold");
    expect(lists[3]).not.toContain("post_sold");
    expect(lists[3]).not.toContain("post_kept");
  });
  it("claims the earlier kinds after a list-length refusal, and keeps using them", async () => {
    refuse("supported mail kinds required");
    expect(await run()).toMatchObject({ succeeded: 1 });
    const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
    // The follow-up claim keeps the earlier list instead of asking again.
    expect(lists.map((l) => l.length)).toEqual([3, 17, 16, 14, 14]);
  });
  it("drops only the ID-returned notice for a database without that update", async () => {
    queue(job({ kind: "post_kept" }));
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "claim_supported_notification_outbox" &&
      args.p_supported_kinds.includes("verification_returned")
        ? { data: null, error: { code: "22023", message: "unsupported mail kind" } }
        : base(name, args)
    );
    expect(await run()).toMatchObject({ succeeded: 1 });
    const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
    expect(lists.map((l) => l.length)).toEqual([3, 17, 16, 16]);
    expect(lists[3]).toContain("post_kept");
    expect(lists[3]).not.toContain("verification_returned");
  });
  it("does not retry the claim after another invalid-parameter refusal", async () => {
    rpc.mockImplementation(async (name) =>
      name === "claim_supported_notification_outbox"
        ? { data: null, error: { code: "22023", message: "invalid limit" } }
        : { data: {}, error: null }
    );
    await expect(run()).rejects.toThrow(OperationJobsIncompleteError);
    expect(calls("claim_supported_notification_outbox")).toHaveLength(2);
  });
});
it("passes the trial's end with the trial_started notice, and none from an earlier database", async () => {
  const other = "00000000-0000-4000-8000-000000000003";
  queue(
    job({
      kind: "trial_started",
      trial_ends_at: "2026-11-17T08:00:00+00:00",
      trial_funds_post: true,
    }),
    job({ id: other, kind: "trial_started" })
  );
  expect(await run()).toMatchObject({ claimed: 2, succeeded: 2, failed: [] });
  expect(deliver.mock.calls).toEqual([
    [
      "synthetic@example.invalid",
      "trial_started",
      `foundation-outbox/${id}`,
      undefined,
      { trialEndsAt: "2026-11-17T08:00:00+00:00", trialFundsPost: true },
    ],
    [
      "synthetic@example.invalid",
      "trial_started",
      `foundation-outbox/${other}`,
      undefined,
      { trialEndsAt: null, trialFundsPost: null },
    ],
  ]);
});

describe("payment alerts", () => {
  it("runs the staff payment step after member payment messages and before other kinds", async () => {
    const order: string[] = [];
    queue(job(), job({ id: "00000000-0000-4000-8000-000000000009", kind: "trial_started" }));
    paymentAlerts.mockImplementation(async (context) => {
      order.push("payment alerts");
      expect(context.canClaim()).toBe(true);
      await context.call("claim_payment_alerts", { p_limit: 20 }, context.claimSignal);
      await context.pace(async () => order.push("payment alert send"));
      return [];
    });
    deliver.mockImplementation(async (_to, kind) => {
      order.push(kind);
      return { success: true };
    });
    expect(await run()).toMatchObject({ claimed: 2, succeeded: 2, failed: [] });
    // A slow staff send never holds up a member's payment message.
    expect(order).toEqual([
      "payment_completed",
      "payment alerts",
      "payment alert send",
      "trial_started",
    ]);
    expect(calls("claim_payment_alerts")).toEqual([["claim_payment_alerts", { p_limit: 20 }]]);
  });

  it("fails the run with the payment step's failed steps, after every other step", async () => {
    paymentAlerts.mockResolvedValue(["payment_alert", "payment_summary:claim"]);
    const error = await run().catch((e) => e);
    expect(error).toBeInstanceOf(OperationJobsIncompleteError);
    expect(error.failed).toEqual(["payment_alert", "payment_summary:claim"]);
    expect(error.summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(deliver).toHaveBeenCalledOnce();
    for (const name of SWEEPS) expect(calls(name)).toHaveLength(1);
  });

  it("still sends the queued emails when the payment step throws", async () => {
    paymentAlerts.mockRejectedValue(new Error("PRIVATE_DETAIL"));
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["payment_alert"]);
    expect(error.message).not.toContain("PRIVATE");
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("offers no claim to the payment step once a worst-case send no longer fits", async () => {
    let clock = Date.parse("2026-11-12T08:00:00Z");
    let late: boolean | undefined;
    paymentAlerts.mockImplementation(async (context) => {
      clock += 14_000;
      late = context.canClaim();
      return [];
    });
    await run({ now: () => clock });
    expect(late).toBe(false);
  });

  it("by default claims the payment alerts and the daily summary, and sends nothing when there is nothing", async () => {
    const { sendStaffOperationsEmail } = await import("../services/email");
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "claim_payment_alerts"
        ? { data: { claim: null, problems: [] }, error: null }
        : name === "claim_payment_digest"
          ? { data: null, error: null }
          : base(name, args)
    );
    expect(
      await runFoundationOperationJobs(service, deliver, { alertStaff, sleep: async () => {} })
    ).toMatchObject({ claimed: 1, succeeded: 1, failed: [] });
    expect(calls("claim_payment_alerts")).toEqual([["claim_payment_alerts", { p_limit: 20 }]]);
    expect(calls("claim_payment_digest")).toEqual([
      ["claim_payment_digest", { p_from_hour: 7, p_limit: 20 }],
    ]);
    expect(sendStaffOperationsEmail).not.toHaveBeenCalled();
  });
});

describe("payment receipts (M3.7)", () => {
  const payment = "00000000-0000-4000-8000-0000000000a1";
  const owner = "00000000-0000-4000-8000-0000000000b2";
  const row = {
    payment_id: payment,
    owner_id: owner,
    amount_cents: 6900,
    currency: "ZAR",
    completed_at: "2026-11-13T07:15:00.123456+00:00",
    product_kind: "plan",
    label: "Individual slot — 30 days",
    slots: 1,
    invoice_description: "Individual slot — 30 days",
    invoice_number: "INV-20261113-ABCDEF1234",
    issued_at: "2026-11-13T07:15:00.123456+00:00",
    merchant_reference: "abcdef12345678901234567890abcdef",
    provider_transaction_id: "synthetic-transaction",
    status: "complete",
    fulfillment_status: "fulfilled",
  };
  const receipt = {
    kind: "plan",
    invoiceNumber: "INV-20261113-ABCDEF1234",
    paidAt: "2026-11-13T07:15:00.123456+00:00",
    item: "Individual slot — 30 days",
    amountCents: 6900,
    bankReference: "abcdef12345678",
  };
  const paymentJob = (extra: Record<string, unknown> = {}) =>
    job({ subject_id: payment, owner_id: owner, ...extra });
  // Queues the jobs and answers the receipt read with `reply`.
  function queueWithReceipt(reply: () => unknown, ...items: Array<Record<string, unknown>>) {
    queue(...items);
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "get_payment_receipt" ? reply() : base(name, args)
    );
  }

  it("reads the payment's receipt and sends it under the message's own key", async () => {
    queueWithReceipt(() => ({ data: row, error: null }), paymentJob());
    expect(await run()).toMatchObject({ succeeded: 1, retrying: 0, failed: [] });
    expect(calls("get_payment_receipt")).toEqual([
      ["get_payment_receipt", { p_payment_id: payment }],
    ]);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      "synthetic@example.invalid",
      "payment_completed",
      `foundation-outbox/${id}`,
      undefined,
      { receipt }
    );
  });

  it("sends the same request under the same key when a delivery is retried", async () => {
    queueWithReceipt(() => ({ data: row, error: null }), paymentJob());
    deliver.mockResolvedValueOnce({ success: false });
    expect(await run()).toMatchObject({ succeeded: 0, retrying: 1 });
    queueWithReceipt(() => ({ data: row, error: null }), paymentJob({ attempts: 2 }));
    expect(await run()).toMatchObject({ succeeded: 1 });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[1]).toEqual(deliver.mock.calls[0]);
  });

  it("gives the message back without sending when the receipt read fails", async () => {
    queueWithReceipt(() => ({ data: null, error: { message: "unavailable" } }), paymentJob());
    const error = await run().catch((e) => e);
    expect(error).toBeInstanceOf(OperationJobsIncompleteError);
    expect(error.failed).toEqual(["outbox:receipt"]);
    expect(error.summary).toMatchObject({ succeeded: 0, retrying: 1, lost: 0 });
    expect(deliver).not.toHaveBeenCalled();
    expect(calls("complete_notification_outbox")).toEqual([
      [
        "complete_notification_outbox",
        { p_id: id, p_claim: claim, p_ok: false, p_error: "receipt_unavailable" },
      ],
    ]);
  });

  it("sends the notice without details on the last attempt when the read still fails", async () => {
    queueWithReceipt(
      () => ({ data: null, error: { message: "unavailable" } }),
      paymentJob({ attempts: OUTBOX_FINAL_ATTEMPT })
    );
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["outbox:receipt"]);
    expect(error.summary).toMatchObject({ succeeded: 1, lost: 0 });
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      "synthetic@example.invalid",
      "payment_completed",
      `foundation-outbox/${id}`
    );
  });

  it.each([
    ["an unknown payment", null],
    ["another member's payment", { ...row, owner_id: "00000000-0000-4000-8000-0000000000c3" }],
    ["another payment", { ...row, payment_id: "00000000-0000-4000-8000-0000000000d4" }],
    ["a payment without an invoice", { ...row, invoice_number: null }],
    ["a payment in another currency", { ...row, currency: "USD" }],
  ])("sends the notice without details for %s", async (_name, data) => {
    queueWithReceipt(() => ({ data, error: null }), paymentJob());
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["outbox:receipt"]);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(
      "synthetic@example.invalid",
      "payment_completed",
      `foundation-outbox/${id}`
    );
  });

  it.each(["refunded", "chargeback"])(
    "sends no receipt at all for a payment %s before the email went out",
    async (status) => {
      queueWithReceipt(() => ({ data: { ...row, status }, error: null }), paymentJob());
      expect(await run()).toMatchObject({ succeeded: 1, retrying: 0, failed: [] });
      expect(deliver).not.toHaveBeenCalled();
      expect(calls("complete_notification_outbox")).toEqual([
        ["complete_notification_outbox", { p_id: id, p_claim: claim, p_ok: true }],
      ]);
    }
  );

  it("still sends the notice without details when another member's payment is refunded", async () => {
    queueWithReceipt(
      () => ({
        data: { ...row, status: "refunded", owner_id: "00000000-0000-4000-8000-0000000000c3" },
        error: null,
      }),
      paymentJob()
    );
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["outbox:receipt"]);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("reads no receipt for a removed recipient or another kind", async () => {
    queueWithReceipt(
      () => ({ data: row, error: null }),
      paymentJob({ recipient: null }),
      paymentJob({ id: "00000000-0000-4000-8000-0000000000e5", kind: "payment_reversed" })
    );
    expect(await run()).toMatchObject({ succeeded: 2, failed: [] });
    expect(calls("get_payment_receipt")).toHaveLength(0);
  });

  it("gives the message back when the read leaves too little time to send", async () => {
    let t = 0;
    queueWithReceipt(() => {
      t += 20_000;
      return { data: row, error: null };
    }, paymentJob());
    expect(await run({ now: () => t })).toMatchObject({ succeeded: 0, retrying: 1 });
    expect(deliver).not.toHaveBeenCalled();
    expect(calls("complete_notification_outbox")).toEqual([
      [
        "complete_notification_outbox",
        { p_id: id, p_claim: claim, p_ok: false, p_error: "deferred" },
      ],
    ]);
  });

  it("matches what the database's claim and receipt read return", () => {
    const read = (file: string) =>
      readFileSync(join(process.cwd(), "database/foundation/current/functions", file), "utf8");
    const claimSql = read("internal/claim_supported_notification_outbox.sql");
    expect(claimSql).toContain("'subject_id',o.subject_id");
    expect(claimSql).toContain("'owner_id',o.owner_id");
    const settle = read("internal/apply_provider_event.sql");
    expect(settle).toContain(
      "values ('payment_completed', pay.id, pay.owner_id, 'payment_completed:' || pay.id)"
    );
    const receiptSql = read("internal/get_payment_receipt.sql");
    for (const field of Object.keys(row)) expect(receiptSql).toContain(`'${field}'`);
    expect(read("api/get_payment_receipt.sql")).toContain(
      "grant execute on function api.get_payment_receipt(uuid) to service_role;"
    );
  });
});
