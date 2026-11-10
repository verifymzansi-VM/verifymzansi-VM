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
import { runFoundationPrivacyNotice } from "./privacy-notice-job";
vi.mock("server-only", () => ({}));
vi.mock("../services/email", () => ({
  sendPlatformNotice: vi.fn(),
  sendOutboxFinalFailureAlert: vi.fn(),
}));
vi.mock("./privacy-notice-job", () => ({ runFoundationPrivacyNotice: vi.fn(async () => "empty") }));
const privacy = vi.mocked(runFoundationPrivacyNotice);
const id = "00000000-0000-4000-8000-000000000001";
const claim = "00000000-0000-4000-8000-000000000002";
const rpc = vi.fn(),
  deliver = vi.fn(),
  alertStaff = vi.fn();
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
  runFoundationOperationJobs(service, deliver, { alertStaff, sleep: async () => {}, ...options });
const calls = (name: string) => rpc.mock.calls.filter(([n]) => n === name);
beforeEach(() => {
  vi.clearAllMocks();
  privacy.mockResolvedValue("empty");
  deliver.mockResolvedValue({ success: true });
  alertStaff.mockResolvedValue({ success: true });
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

describe("batch size, order and time limit", () => {
  const make = (n: number, kind: string, from = 0) =>
    Array.from({ length: n }, (_, i) =>
      job({ id: `00000000-0000-4000-8000-${String(from + i).padStart(12, "0")}`, kind })
    );

  it("sends 100 queued messages within five runs, payment messages first", async () => {
    // Oldest first in the queue; the ten payment messages were queued last.
    const items = [...make(90, "post_expiry_reminder", 100), ...make(10, "payment_completed", 900)];
    queue(...items);
    const perRun: number[] = [];
    for (let r = 0; r < 5; r++) {
      const before = deliver.mock.calls.length;
      await run();
      perRun.push(deliver.mock.calls.length - before);
    }
    expect(perRun).toEqual([25, 25, 25, 25, 0]);
    const keys = deliver.mock.calls.map(([, , key]) => key);
    expect(new Set(keys).size).toBe(100);
    expect(deliver.mock.calls.slice(0, 10).map(([, kind]) => kind)).toEqual(
      Array(10).fill("payment_completed")
    );
    expect(OUTBOX_RUN_LIMIT).toBeGreaterThanOrEqual(20);
  });

  it("claims in small chunks, payment kinds before the others", async () => {
    queue(...make(12, "enquiry_received", 100), ...make(2, "payment_reversed", 900));
    await run();
    const claims = calls("claim_supported_notification_outbox").map(([, a]) => ({
      limit: a.p_limit,
      payment: a.p_supported_kinds.every((k: string) => PAYMENT.includes(k)),
    }));
    expect(claims).toEqual([
      { limit: 5, payment: true },
      { limit: 5, payment: false },
      { limit: 5, payment: false },
      { limit: 5, payment: false },
    ]);
    expect(deliver).toHaveBeenCalledTimes(14);
    expect(deliver.mock.calls.slice(0, 2).map(([, kind]) => kind)).toEqual([
      "payment_reversed",
      "payment_reversed",
    ]);
    for (const [, args] of calls("claim_supported_notification_outbox"))
      expect(args.p_limit).toBeLessThanOrEqual(5);
  });

  it("paces sends to the provider's rate", async () => {
    queue(...make(3, "payment_completed"));
    let clock = 1_000_000;
    const sleep = vi.fn(async (ms: number) => void (clock += ms));
    await run({ now: () => clock, sleep });
    // Two waits between the three emails, one before the privacy notice step.
    expect(sleep.mock.calls).toEqual([[500], [500], [500]]);
  });

  it("stops claiming after the claim cutoff", async () => {
    queue(...make(30, "post_expiry_reminder"));
    let clock = 1_000_000;
    deliver.mockImplementation(async () => {
      clock += 4_000;
      return { success: true };
    });
    await run({ now: () => clock });
    // Chunk 1 (0-20 s) is sent; no further chunk is claimed after 20 s.
    expect(calls("claim_supported_notification_outbox")).toHaveLength(2);
    expect(deliver).toHaveBeenCalledTimes(5);
  });

  it("gives back claimed messages it can no longer send safely", async () => {
    const start = Date.now();
    queue(...make(5, "payment_completed"));
    let clock = start;
    deliver.mockImplementation(async () => {
      clock += 9_000;
      return { success: true };
    });
    await run({ now: () => clock });
    // Sends start at 0 and 9 s; at 18 s a worst-case send no longer fits.
    expect(deliver).toHaveBeenCalledTimes(2);
    const deferred = calls("complete_notification_outbox").filter(
      ([, a]) => a.p_error === "deferred"
    );
    expect(deferred).toHaveLength(3);
    expect(deferred[0][1]).toMatchObject({ p_ok: false });
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

  it("sends 100 queued messages within five runs at realistic speeds", async () => {
    // Simulated clock: 150 ms per database call, 400 ms per send, real pacing.
    let clock = Date.parse("2026-11-10T08:00:00Z");
    const items = make(100, "post_expiry_reminder", 100);
    queue(...items);
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) => {
      clock += 150;
      const result = await base(name, args);
      if (name === "claim_supported_notification_outbox")
        for (const row of result.data) row.locked_until = new Date(clock + 90_000).toISOString();
      return result;
    });
    deliver.mockImplementation(async () => {
      clock += 400;
      return { success: true };
    });
    const sleep = async (ms: number) => void (clock += ms);
    let elapsed = 0;
    for (let r = 0; r < 5; r++) {
      const start = clock;
      await run({ now: () => clock, sleep });
      elapsed = Math.max(elapsed, clock - start);
      clock += 60_000;
    }
    expect(new Set(deliver.mock.calls.map(([, , key]) => key)).size).toBe(100);
    expect(elapsed).toBeLessThan(45_000);
  });

  it("claims only what fits before the send cutoff at the speed seen", async () => {
    // 800 ms per message (650 ms send, 150 ms per database call).
    let clock = Date.parse("2026-11-10T08:00:00Z");
    queue(...make(30, "post_expiry_reminder", 100));
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) => {
      if (!SWEEPS.includes(name)) clock += 150;
      const result = await base(name, args);
      if (name === "claim_supported_notification_outbox")
        for (const row of result.data) row.locked_until = new Date(clock + 90_000).toISOString();
      return result;
    });
    deliver.mockImplementation(async () => {
      clock += 650;
      return { success: true };
    });
    await run({ now: () => clock, sleep: async (ms: number) => void (clock += ms) });
    expect(calls("complete_notification_outbox").every(([, a]) => a.p_error !== "deferred")).toBe(
      true
    );
    // Claims of 5, 5 and 5, then only the 3 that still fit before 16 s.
    expect(deliver).toHaveBeenCalledTimes(18);
  });

  it("claims one at a time after a slow send", async () => {
    queue(...make(8, "post_expiry_reminder"));
    let clock = 1_000_000;
    deliver.mockImplementationOnce(async () => {
      clock += 4_000;
      return { success: true };
    });
    await run({ now: () => clock });
    const limits = calls("claim_supported_notification_outbox").map(([, a]) => a.p_limit);
    expect(limits).toEqual([5, 5, 1, 1, 1, 1]);
    expect(deliver).toHaveBeenCalledTimes(8);
  });

  it("handles last attempts first within a claimed chunk", async () => {
    const other = "00000000-0000-4000-8000-000000000003";
    queue(job({ id: other, attempts: 2 }), job({ attempts: OUTBOX_FINAL_ATTEMPT }));
    await run();
    expect(deliver.mock.calls.map(([, , key]) => key)).toEqual([
      `foundation-outbox/${id}`,
      `foundation-outbox/${other}`,
    ]);
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

  it("sends one alert for several lost messages in a run", async () => {
    const other = "00000000-0000-4000-8000-000000000003";
    queue(job(last), job({ ...last, id: other, kind: "payment_reversed" }));
    deliver.mockRejectedValue(new Error("provider down"));
    await run();
    expect(alertStaff).toHaveBeenCalledOnce();
    expect(alertStaff.mock.calls[0][0]).toEqual([
      { id, kind: "payment_completed" },
      { id: other, kind: "payment_reversed" },
    ]);
  });

  it("sends at most two alerts a run and reports the rest as a failed alert", async () => {
    const ids = [3, 4, 5, 6, 7, 8].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    // One lost payment message, then lost messages of other kinds in two chunks.
    queue(job(last), ...ids.map((other) => job({ ...last, id: other, kind: "enquiry_received" })));
    deliver.mockResolvedValue({ success: false });
    const error = await run().catch((e) => e);
    expect(alertStaff).toHaveBeenCalledTimes(2);
    expect(alertStaff.mock.calls[0][0]).toEqual([{ id, kind: "payment_completed" }]);
    expect(alertStaff.mock.calls[1][0]).toHaveLength(5);
    expect(error.failed).toEqual(["staff_alert"]);
    expect(error.summary.lost).toBe(7);
  });

  it("alerts before sending the rest of the claim it came in", async () => {
    const other = "00000000-0000-4000-8000-000000000003";
    queue(job({ id: other, attempts: 2 }), job(last));
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

  it("passes the run's time limits to the privacy notice step", async () => {
    let clock = 1_000_000;
    let seen: { signal?: AbortSignal; canSend?: () => boolean } = {};
    privacy.mockImplementation(async (_service, run = {}) => {
      seen = run;
      return "empty";
    });
    await run({ now: () => clock });
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.canSend?.()).toBe(true);
    clock += 17_000;
    expect(seen.canSend?.()).toBe(false);
  });

  it("does not claim when what it returns could no longer be sent", async () => {
    let clock = 1_000_000;
    privacy.mockImplementation(async () => {
      clock += 14_000;
      return "empty";
    });
    queue(job());
    // One payment claim at 0 s; the privacy step ends after 14 s, past the last claim time (13 s).
    await run({ now: () => clock });
    expect(calls("claim_supported_notification_outbox")).toHaveLength(1);
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
    await runFoundationOperationJobs(service, deliver, { sleep: async () => {} });
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
  expect(new Set(lists.flat()).size).toBe(19);
  for (const list of lists) expect(list.length).toBeLessThanOrEqual(19);
  expect(deliver).toHaveBeenCalledExactlyOnceWith(
    "synthetic@example.invalid",
    "post_sold",
    `foundation-outbox/${id}`,
    undefined,
    { deletesAt: null, holdsSlot: null }
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
    expect(lists.map((l) => l.length)).toEqual([3, 16, 14]);
    expect(lists[2]).not.toContain("post_sold");
    expect(lists[2]).not.toContain("post_kept");
  });
  it("claims the earlier kinds after a list-length refusal, and keeps using them", async () => {
    refuse("supported mail kinds required");
    expect(await run()).toMatchObject({ succeeded: 1 });
    const lists = calls("claim_supported_notification_outbox").map(([, a]) => a.p_supported_kinds);
    expect(lists.map((l) => l.length)).toEqual([3, 16, 14]);
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
