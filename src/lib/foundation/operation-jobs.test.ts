/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import {
  MISSING_SWEEP_WARNING_MS,
  OperationJobsIncompleteError,
  OUTBOX_FINAL_ATTEMPT,
  OUTBOX_RUN_LIMIT,
  runFoundationOperationJobs,
} from "./operation-jobs";
import { runFoundationPrivacyNotice, type PrivacyNoticeRun } from "./privacy-notice-job";
vi.mock("server-only", () => ({}));
vi.mock("../services/email", () => ({
  sendPlatformNotice: vi.fn(),
  sendLostEmailAlert: vi.fn(),
  sendStaffDeadlineEmail: vi.fn(),
  sendStaffOperationsEmail: vi.fn(),
}));
vi.mock("./privacy-notice-job", () => ({ runFoundationPrivacyNotice: vi.fn(async () => "empty") }));
const privacy = vi.mocked(runFoundationPrivacyNotice);
const id = "00000000-0000-4000-8000-000000000001";
const claim = "00000000-0000-4000-8000-000000000002";
const rpc = vi.fn(),
  // The lost-email alert's two commands (claim and complete), kept apart from
  // `rpc` so the other tests see only their own calls.
  lostRpc = vi.fn(),
  deliver = vi.fn(),
  deliverStaff = vi.fn(),
  lostEmailAlert = vi.fn(),
  // The payment alert step has its own tests (payment-alerts.test.ts); here
  // it is a stand-in unless a test says otherwise.
  paymentAlerts = vi.fn();
const service = {
  rpc: (name: string, args: unknown) =>
    name.endsWith("_lost_email_alert") ? lostRpc(name, args) : rpc(name, args),
} as unknown as FoundationServiceApi;
const noLostAlert = { claim: null, total: 0, items: [] };
const SWEEPS = [
  "run_slot_renewals",
  "run_post_lifecycle",
  "sweep_sponsorships",
  "purge_expired_inbox",
  "reconcile_intro_trials",
  "approve_due_commissions",
  "expire_waiting_bank_transfers",
  "void_ended_package_add_invoices",
  "purge_post_engagement",
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
    lostEmailAlert,
    deliverStaff,
    paymentAlerts,
    sleep: async () => {},
    ...options,
  });
const calls = (name: string) => rpc.mock.calls.filter(([n]) => n === name);
beforeEach(() => {
  vi.clearAllMocks();
  privacy.mockResolvedValue("empty");
  deliver.mockResolvedValue({ success: true });
  deliverStaff.mockResolvedValue({ success: true });
  lostEmailAlert.mockResolvedValue({ success: true });
  lostRpc.mockImplementation(async (name: string) => ({
    data: name === "claim_lost_email_alert" ? noLostAlert : true,
    error: null,
  }));
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
  expect(lostEmailAlert).not.toHaveBeenCalled();
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

  it("expires waiting bank transfers on every run (the 14 days are decided in the database)", async () => {
    await run();
    expect(calls("expire_waiting_bank_transfers")).toEqual([
      ["expire_waiting_bank_transfers", { p_limit: 50 }],
    ]);
  });

  it("skips the bank transfer expiry against a database without it, and fails on other errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missingWarnings = () =>
      warn.mock.calls.filter(([line]) => String(line).includes("Sweep command missing")).length;
    // A clock of its own, far from the other tests' runs.
    const clock = { t: Date.now() + 400 * 86_400_000 };
    for (const [code, advance, warned] of [
      ["PGRST202", 0, 1],
      ["42883", MISSING_SWEEP_WARNING_MS / 2, 1],
      ["PGRST202", MISSING_SWEEP_WARNING_MS, 2],
    ] as const) {
      clock.t += advance;
      queue(job());
      const queued = rpc.getMockImplementation()!;
      rpc.mockImplementation(async (name, args) =>
        name === "expire_waiting_bank_transfers"
          ? { data: null, error: { code, message: "not found" } }
          : queued(name, args)
      );
      await expect(run({ now: () => clock.t })).resolves.toMatchObject({ failed: [] });
      // Logged, at most once an hour.
      expect(missingWarnings()).toBe(warned);
    }
    warn.mockRestore();
    queue(job());
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "expire_waiting_bank_transfers"
        ? { data: null, error: { code: "XX000" } }
        : base(name, args)
    );
    const error = await run().catch((e) => e);
    expect(error).toBeInstanceOf(OperationJobsIncompleteError);
    expect(error.failed).toEqual(["sweep:expire_waiting_bank_transfers"]);
    // Only the newest sweep may be missing: an older one missing still fails.
    rpc.mockImplementation(async (name, args) =>
      name === "run_slot_renewals" ? { data: null, error: { code: "PGRST202" } } : base(name, args)
    );
    expect((await run().catch((e) => e)).failed).toEqual(["sweep:run_slot_renewals"]);
  });

  it("warns when the expiry sweep left rows it could not change", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "expire_waiting_bank_transfers"
        ? {
            data: {
              expired: 3,
              with_invoice: 1,
              failed: 1,
              failures: [{ transfer_id: id, sqlstate: "P0001" }],
            },
            error: null,
          }
        : base(name, args)
    );
    await expect(run()).resolves.toMatchObject({ failed: [] });
    const line = warn.mock.calls
      .map(([text]) => String(text))
      .find((text) => text.includes("Sweep left rows it could not change"));
    // Each failed row is logged with its transfer id and SQLSTATE.
    expect(line).toContain(id);
    expect(line).toContain("P0001");
    warn.mockRestore();
  });

  it("emails staff once about a newly stuck package move and keeps the run passing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const lines = (spy: typeof warn, text: string) =>
      spy.mock.calls.map(([line]) => String(line)).filter((line) => line.includes(text));
    const packageMoveAlert = vi.fn(async () => ({ success: true }));
    const base = rpc.getMockImplementation()!;
    const sweepReply = (data: Record<string, unknown>) =>
      rpc.mockImplementation(async (name, args) =>
        name === "run_slot_renewals" ? { data, error: null } : base(name, args)
      );
    // Skipped but not stuck: a warning, no email, the run succeeds.
    sweepReply({ moved: 0, package_skipped: 2, package_stuck: 0, package_stuck_moves: [] });
    await expect(run({ packageMoveAlert })).resolves.toMatchObject({ failed: [] });
    expect(lines(warn, "Package moves skipped this run")).toHaveLength(1);
    expect(packageMoveAlert).not.toHaveBeenCalled();
    // Newly stuck: one email with ids only; the run still passes.
    const move = {
      package_id: id,
      post_id: claim,
      direction: "into_package",
      tries: 31,
      first_failed_at: "2026-11-19T10:02:00.000Z",
      reason: "busy",
    };
    sweepReply({ package_skipped: 1, package_stuck: 1, package_stuck_moves: [move] });
    await expect(run({ packageMoveAlert })).resolves.toMatchObject({ failed: [] });
    expect(packageMoveAlert).toHaveBeenCalledExactlyOnceWith([move]);
    expect(lines(errorLog, "Package move stuck")[0]).toContain(claim);
    // Still stuck but already reported: no second email, the run passes.
    sweepReply({ package_skipped: 1, package_stuck: 1, package_stuck_moves: [] });
    await expect(run({ packageMoveAlert })).resolves.toMatchObject({ failed: [] });
    expect(packageMoveAlert).toHaveBeenCalledOnce();
    expect(lines(warn, "Package moves stuck").length).toBeGreaterThan(0);
    // An email that cannot go out fails that one run, with the moves logged.
    packageMoveAlert.mockResolvedValueOnce({ success: false });
    sweepReply({ package_stuck: 1, package_stuck_moves: [move] });
    const error = await run({ packageMoveAlert }).catch((e) => e);
    expect(error).toBeInstanceOf(OperationJobsIncompleteError);
    expect(error.failed).toEqual(["package_move_alert"]);
    expect(lines(errorLog, "Package move alert not emailed")).toHaveLength(1);
    // An earlier database sends neither count: nothing happens.
    sweepReply({ moved: 0, package_skipped: 0 });
    await expect(run({ packageMoveAlert })).resolves.toMatchObject({ failed: [] });
    expect(packageMoveAlert).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    errorLog.mockRestore();
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
    expect(lostEmailAlert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("complete_notification_outbox", {
      p_id: id,
      p_claim: claim,
      p_ok: false,
      p_error: "outcome_unknown",
    });
  });

  it("counts a last-attempt unknown outcome as lost (the database reports it)", async () => {
    queue(job({ attempts: OUTBOX_FINAL_ATTEMPT }));
    deliver.mockResolvedValue({ success: false, outcomeUnknown: true });
    expect(await run()).toMatchObject({ retrying: 1, lost: 1, failed: [] });
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
    expect(lostEmailAlert).not.toHaveBeenCalled();
  });
});

describe("last attempt and the lost-email alert", () => {
  const last = { attempts: OUTBOX_FINAL_ATTEMPT };
  const alertId = "00000000-0000-4000-8000-0000000000a1";
  const alert = {
    claim: alertId,
    total: 3,
    items: [
      {
        source: "outbox",
        id,
        kind: "payment_completed",
        attempts: 8,
        queued_at: "2026-11-25T08:00:00+00:00",
        last_error: "delivery_failed",
      },
      {
        source: "privacy_notice",
        id: claim,
        kind: "privacy_notice_submitted",
        attempts: 8,
        queued_at: "2026-11-25T08:05:00+00:00",
        last_error: null,
      },
    ],
  };
  const offer = (data: unknown, error: unknown = null) =>
    lostRpc.mockImplementation(async (name: string) =>
      name === "claim_lost_email_alert" ? { data, error } : { data: true, error: null }
    );
  const lostCalls = (name: string) => lostRpc.mock.calls.filter(([n]) => n === name);

  it("counts and logs a message that fails its last attempt, and alerts only from the database", async () => {
    queue(job(last));
    deliver.mockResolvedValue({ success: false });
    expect(await run()).toMatchObject({ retrying: 1, lost: 1, failed: [] });
    expect(lostCalls("claim_lost_email_alert")).toEqual([
      ["claim_lost_email_alert", { p_limit: 50 }],
    ]);
    expect(lostEmailAlert).not.toHaveBeenCalled();
  });

  it("sends the database's alert once and records it as sent", async () => {
    offer(alert);
    expect(await run()).toMatchObject({ failed: [] });
    expect(lostEmailAlert).toHaveBeenCalledExactlyOnceWith(alert);
    expect(lostCalls("complete_lost_email_alert")).toEqual([
      ["complete_lost_email_alert", { p_claim: alertId, p_sent: true }],
    ]);
    expect(JSON.stringify(lostEmailAlert.mock.calls)).not.toContain("synthetic@example.invalid");
  });

  it("counts an alert refused as a repeat of its own request as sent", async () => {
    offer(alert);
    lostEmailAlert.mockResolvedValue({ success: false, outcomeUnknown: true });
    expect(await run()).toMatchObject({ failed: [] });
    expect(lostCalls("complete_lost_email_alert")[0][1]).toEqual({
      p_claim: alertId,
      p_sent: true,
    });
  });

  it.each([
    ["refused", () => lostEmailAlert.mockResolvedValue({ success: false })],
    ["thrown", () => lostEmailAlert.mockRejectedValue(new Error("provider down"))],
  ])("gives the alert back and fails the run when its send is %s", async (_label, fail) => {
    offer(alert);
    fail();
    const error = await run().catch((e) => e);
    expect(error).toBeInstanceOf(OperationJobsIncompleteError);
    expect(error.failed).toEqual(["lost_email_alert"]);
    expect(lostCalls("complete_lost_email_alert")).toEqual([
      ["complete_lost_email_alert", { p_claim: alertId, p_sent: false }],
    ]);
  });

  it("fails the run when the alert's send cannot be recorded", async () => {
    lostRpc.mockImplementation(async (name: string) =>
      name === "claim_lost_email_alert"
        ? { data: alert, error: null }
        : { data: null, error: { message: "request failed" } }
    );
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["lost_email_alert"]);
  });

  it.each([
    ["an error", null, { code: "XX000" }],
    ["an unreadable reply", { claim: alertId, total: 1, items: [{ id: "x" }] }, null],
  ])("fails the run and sends nothing when the claim returns %s", async (_l, data, err) => {
    offer(data, err);
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["lost_email_alert"]);
    expect(lostEmailAlert).not.toHaveBeenCalled();
    expect(lostCalls("complete_lost_email_alert")).toEqual([]);
  });

  it("claims the alert after the payment step and before the privacy notices", async () => {
    offer(alert);
    const order: string[] = [];
    paymentAlerts.mockImplementation(async () => {
      order.push("payments");
      return [];
    });
    lostEmailAlert.mockImplementation(async () => {
      order.push("alert");
      return { success: true };
    });
    privacy.mockImplementation(async () => {
      order.push("privacy");
      return "empty";
    });
    await run();
    expect(order).toEqual(["payments", "alert", "privacy"]);
  });

  it("does not claim an alert that a worst-case send no longer fits", async () => {
    offer(alert);
    queue(job());
    let clock = 1_000_000;
    deliver.mockImplementation(async () => {
      clock += 20_000;
      return { success: true };
    });
    await run({ now: () => clock });
    expect(lostCalls("claim_lost_email_alert")).toEqual([]);
    expect(lostEmailAlert).not.toHaveBeenCalled();
  });

  it("uses the support-address alert email by default", async () => {
    const { sendLostEmailAlert } = await import("../services/email");
    vi.mocked(sendLostEmailAlert).mockResolvedValue({ success: true });
    offer(alert);
    await runFoundationOperationJobs(service, deliver, { paymentAlerts, sleep: async () => {} });
    expect(sendLostEmailAlert).toHaveBeenCalledExactlyOnceWith(alert);
  });

  it("matches what the database's lost-email alert returns", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "database/foundation/current/functions/internal/claim_lost_email_alert.sql"
      ),
      "utf8"
    );
    expect(sql).toContain("o.delivery_attempts>=" + OUTBOX_FINAL_ATTEMPT);
    expect(sql).toContain("j.attempts>=" + OUTBOX_FINAL_ATTEMPT);
    expect(sql).toContain("p_limit not between 1 and 50");
    for (const field of [
      "'claim'",
      "'total'",
      "'items'",
      "'source'",
      "'queued_at'",
      "'last_error'",
    ])
      expect(sql).toContain(field);
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
  // Recorded as skipped, so the member's email history does not list it as sent.
  expect(calls("complete_notification_outbox")).toEqual([
    ["complete_notification_outbox", { p_id: id, p_claim: claim, p_ok: true, p_error: "skipped" }],
  ]);
});
it("declares and delivers the sold-post notice within the database's kind limit", async () => {
  queue(job({ kind: "post_sold" }));
  expect(await run()).toMatchObject({ succeeded: 1 });
  const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
  expect(lists.flat()).toEqual(expect.arrayContaining(["post_sold", "post_kept"]));
  // 26 kinds since the staff deadline emails (20261125105322), each claim within it.
  expect(new Set(lists.flat()).size).toBe(26);
  for (const list of lists) expect(list.length).toBeLessThanOrEqual(26);
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
it("passes the renewal reminder's slot, end date and Renew all to the email", async () => {
  const slot = "00000000-0000-4000-8000-0000000000a1";
  queue(
    job({
      kind: "slot_renewal_reminder",
      subject_id: slot,
      slot_ends_at: "2026-11-17T12:00:00+00:00",
      slot_renew_all: true,
      renewal_kind: "individual",
    })
  );
  expect(await run()).toMatchObject({ succeeded: 1 });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "slot_renewal_reminder",
    `foundation-outbox/${id}`,
    undefined,
    { slotEndsAt: "2026-11-17T12:00:00+00:00", slotRenewAll: true, renewSlotId: slot }
  );
});
it("passes the term-ending notice's end date, kind of term and access to the email", async () => {
  queue(
    job({
      kind: "term_ending_notice",
      subject_id: "00000000-0000-4000-8000-0000000000a2",
      term_ends_at: "2027-02-14T10:00:00+00:00",
      term_kind: "package",
      term_has_access: false,
    })
  );
  expect(await run()).toMatchObject({ succeeded: 1 });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "term_ending_notice",
    `foundation-outbox/${id}`,
    undefined,
    {
      termEndsAt: "2027-02-14T10:00:00+00:00",
      termKind: "package",
      termHasAccess: false,
      termPackageContinues: null,
    }
  );
});
it("passes the free credit reminder's end date to the email", async () => {
  queue(
    job({
      kind: "free_credit_reminder",
      subject_id: "00000000-0000-4000-8000-0000000000a4",
      credit_ends_at: "2026-12-20T10:00:00+00:00",
    })
  );
  expect(await run()).toMatchObject({ succeeded: 1 });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "free_credit_reminder",
    `foundation-outbox/${id}`,
    undefined,
    { creditEndsAt: "2026-12-20T10:00:00+00:00" }
  );
});
it("finishes a free credit reminder the database no longer addresses without sending it", async () => {
  queue(job({ kind: "free_credit_reminder", recipient: null, subject_id: id }));
  expect(await run()).toMatchObject({ succeeded: 1 });
  expect(deliver).not.toHaveBeenCalled();
});
it("passes whether a Multi-listing package outlasts the Individual slot", async () => {
  queue(
    job({
      kind: "term_ending_notice",
      subject_id: "00000000-0000-4000-8000-0000000000a3",
      term_ends_at: "2027-02-14T10:00:00+00:00",
      term_kind: "individual",
      term_has_access: true,
      term_package_continues: true,
    })
  );
  expect(await run()).toMatchObject({ succeeded: 1 });
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "term_ending_notice",
    `foundation-outbox/${id}`,
    undefined,
    {
      termEndsAt: "2027-02-14T10:00:00+00:00",
      termKind: "individual",
      termHasAccess: true,
      termPackageContinues: true,
    }
  );
});
it("finishes a renewal reminder the database no longer addresses without sending it", async () => {
  queue(job({ kind: "slot_renewal_reminder", recipient: null, subject_id: id }));
  expect(await run()).toMatchObject({ succeeded: 1 });
  expect(deliver).not.toHaveBeenCalled();
  expect(calls("complete_notification_outbox")).toEqual([
    ["complete_notification_outbox", { p_id: id, p_claim: claim, p_ok: true, p_error: "skipped" }],
  ]);
});
it("records a sent email without a reason and a skipped one as skipped", async () => {
  const skippedId = "00000000-0000-4000-8000-0000000000f6";
  queue(job(), job({ id: skippedId, kind: "post_deleted", recipient: null }));
  expect(await run()).toMatchObject({ claimed: 2, succeeded: 2, retrying: 0, failed: [] });
  expect(deliver).toHaveBeenCalledOnce();
  const outcomes = calls("complete_notification_outbox").map(([, a]) => [
    a.p_id,
    a.p_ok,
    a.p_error,
  ]);
  expect(outcomes).toEqual(
    expect.arrayContaining([
      [id, true, undefined],
      [skippedId, true, "skipped"],
    ])
  );
  expect(outcomes).toHaveLength(2);
});
it("never records a failed send as skipped", async () => {
  deliver.mockResolvedValue({ success: false });
  expect(await run()).toMatchObject({ succeeded: 0, retrying: 1 });
  expect(rpc).toHaveBeenCalledWith("complete_notification_outbox", {
    p_id: id,
    p_claim: claim,
    p_ok: false,
    p_error: "delivery_failed",
  });
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
    // The newest kinds are dropped first (the staff deadline emails, the free
    // credit reminder, the term-ending notice, the renewal reminder, then the
    // ID-returned notice), then the sold and kept notices.
    expect(lists.map((l) => l.length)).toEqual([3, 23, 20, 19, 18, 17, 16, 14, 14]);
    expect(lists[2]).not.toContain("staff_report");
    expect(lists[2]).toContain("free_credit_reminder");
    expect(lists[3]).not.toContain("free_credit_reminder");
    expect(lists[3]).toContain("term_ending_notice");
    expect(lists[5]).not.toContain("term_ending_notice");
    expect(lists[4]).toContain("slot_renewal_reminder");
    expect(lists[5]).not.toContain("slot_renewal_reminder");
    expect(lists[5]).toContain("verification_returned");
    expect(lists[6]).not.toContain("verification_returned");
    expect(lists[6]).toContain("post_sold");
    expect(lists[7]).not.toContain("post_sold");
    expect(lists[7]).not.toContain("post_kept");
  });
  it("claims the earlier kinds after a list-length refusal, and keeps using them", async () => {
    refuse("supported mail kinds required");
    expect(await run()).toMatchObject({ succeeded: 1 });
    const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
    // The follow-up claim keeps the earlier list instead of asking again.
    expect(lists.map((l) => l.length)).toEqual([3, 23, 20, 19, 18, 17, 16, 14, 14]);
  });
  it("drops only the staff deadline emails for a database without that update", async () => {
    queue(job({ kind: "free_credit_reminder", credit_ends_at: "2026-12-01T10:00:00+00:00" }));
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "claim_supported_notification_outbox" &&
      args.p_supported_kinds.includes("staff_report")
        ? { data: null, error: { code: "22023", message: "supported mail kinds required" } }
        : base(name, args)
    );
    expect(await run()).toMatchObject({ succeeded: 1 });
    const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
    expect(lists.map((l) => l.length)).toEqual([3, 23, 20, 20]);
    expect(lists[3]).toContain("free_credit_reminder");
    for (const kind of ["staff_privacy_request", "staff_appeal", "staff_report"])
      expect(lists[3]).not.toContain(kind);
  });
  it("drops only the free credit reminder for a database without that update", async () => {
    queue(job({ kind: "slot_renewal_reminder", subject_id: id }));
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "claim_supported_notification_outbox" &&
      args.p_supported_kinds.includes("free_credit_reminder")
        ? { data: null, error: { code: "22023", message: "unsupported mail kind" } }
        : base(name, args)
    );
    expect(await run()).toMatchObject({ succeeded: 1 });
    const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
    expect(lists.map((l) => l.length)).toEqual([3, 23, 20, 19, 19]);
    expect(lists[4]).toContain("term_ending_notice");
    expect(lists[4]).not.toContain("free_credit_reminder");
  });
  it("drops only the term-ending notice for a database without that update", async () => {
    queue(job({ kind: "slot_renewal_reminder", subject_id: id }));
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "claim_supported_notification_outbox" &&
      args.p_supported_kinds.includes("term_ending_notice")
        ? { data: null, error: { code: "22023", message: "unsupported mail kind" } }
        : base(name, args)
    );
    expect(await run()).toMatchObject({ succeeded: 1 });
    const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
    expect(lists.map((l) => l.length)).toEqual([3, 23, 20, 19, 18, 18]);
    expect(lists[5]).toContain("slot_renewal_reminder");
    expect(lists[4]).not.toContain("term_ending_notice");
  });
  it("drops only the renewal reminder for a database without that update", async () => {
    queue(job({ kind: "verification_returned" }));
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) =>
      name === "claim_supported_notification_outbox" &&
      args.p_supported_kinds.includes("slot_renewal_reminder")
        ? { data: null, error: { code: "22023", message: "unsupported mail kind" } }
        : base(name, args)
    );
    expect(await run()).toMatchObject({ succeeded: 1 });
    const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
    expect(lists.map((l) => l.length)).toEqual([3, 23, 20, 19, 18, 17, 17]);
    expect(lists[5]).toContain("verification_returned");
    expect(lists[5]).not.toContain("slot_renewal_reminder");
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
    expect(lists.map((l) => l.length)).toEqual([3, 23, 20, 19, 18, 17, 16, 16]);
    expect(lists[6]).toContain("post_kept");
    expect(lists[6]).not.toContain("verification_returned");
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
      await runFoundationOperationJobs(service, deliver, { lostEmailAlert, sleep: async () => {} })
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
        [
          "complete_notification_outbox",
          { p_id: id, p_claim: claim, p_ok: true, p_error: "skipped" },
        ],
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

describe("staff deadline emails", () => {
  const item = "00000000-0000-4000-8000-0000000000b1";
  const staffJob = (extra: Record<string, unknown> = {}) =>
    job({
      kind: "staff_report",
      subject_id: item,
      recipient: "staff@example.invalid",
      staff_item_type: "scam",
      staff_severity: "high",
      staff_received_at: "2026-11-27T13:00:00+00:00",
      staff_due_at: "2026-12-01T13:00:00+00:00",
      ...extra,
    });

  it.each(["staff_privacy_request", "staff_appeal", "staff_report"])(
    "sends %s to its staff member with its details, under the message's own key",
    async (kind) => {
      queue(staffJob({ kind, staff_severity: kind === "staff_report" ? "high" : null }));
      expect(await run()).toMatchObject({ succeeded: 1, failed: [] });
      expect(deliver).not.toHaveBeenCalled();
      expect(deliverStaff).toHaveBeenCalledExactlyOnceWith(
        "staff@example.invalid",
        kind,
        `foundation-outbox/${id}`,
        {
          itemId: item,
          itemType: "scam",
          severity: kind === "staff_report" ? "high" : null,
          receivedAt: "2026-11-27T13:00:00+00:00",
          dueAt: "2026-12-01T13:00:00+00:00",
        }
      );
      expect(rpc).toHaveBeenCalledWith("complete_notification_outbox", {
        p_id: id,
        p_claim: claim,
        p_ok: true,
        p_error: undefined,
      });
    }
  );

  it("finishes a staff email the database no longer addresses as skipped, sending nothing", async () => {
    queue(staffJob({ recipient: null, staff_item_type: null, staff_due_at: null }));
    expect(await run()).toMatchObject({ succeeded: 1 });
    expect(deliverStaff).not.toHaveBeenCalled();
    expect(calls("complete_notification_outbox")).toEqual([
      [
        "complete_notification_outbox",
        { p_id: id, p_claim: claim, p_ok: true, p_error: "skipped" },
      ],
    ]);
  });

  it("gives a staff email back for a retry when its send fails", async () => {
    queue(staffJob());
    deliverStaff.mockRejectedValue(new Error("Staff deadline details unavailable"));
    expect(await run()).toMatchObject({ succeeded: 0, retrying: 1 });
    expect(rpc).toHaveBeenCalledWith("complete_notification_outbox", {
      p_id: id,
      p_claim: claim,
      p_ok: false,
      p_error: "delivery_failed",
    });
  });

  it("refuses a staff email with an unexpected type before sending it", async () => {
    queue(staffJob({ staff_item_type: "Scam <b>" }));
    const error = await run().catch((e) => e);
    expect(error.failed).toEqual(["outbox:invalid_message"]);
    expect(deliverStaff).not.toHaveBeenCalled();
  });

  it("matches what the database's claim returns for staff emails", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "database/foundation/current/functions/internal/claim_supported_notification_outbox.sql"
      ),
      "utf8"
    );
    for (const field of ["staff_item_type", "staff_severity", "staff_received_at", "staff_due_at"])
      expect(sql).toContain(`'${field}'`);
    expect(sql).toContain("cardinality(p_supported_kinds) not between 1 and 26");
  });
});
