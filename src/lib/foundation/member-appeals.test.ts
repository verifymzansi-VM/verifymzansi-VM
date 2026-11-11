import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readFrontendAppeals, readMyFrontendDecisions } from "./member-appeals";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uuid(1);
const at = "2026-11-10T08:00:00+02:00";
const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;

beforeEach(() => {
  vi.resetAllMocks();
});

const decision = (overrides: Record<string, unknown> = {}) => ({
  decisionId: uuid(10),
  kind: "suspension",
  reason: "Repeated misleading listings",
  startsAt: at,
  endsAt: at,
  active: true,
  appealable: true,
  appeal: { id: uuid(11), status: "submitted", outcome: null, resolvedAt: null },
  ...overrides,
});

describe("readMyFrontendDecisions", () => {
  it("returns the signed-in member's own decisions", async () => {
    rpc.mockResolvedValueOnce({
      data: { account_id: actor, items: [decision(), decision({ appeal: null })] },
      error: null,
    });
    await expect(readMyFrontendDecisions(api, actor)).resolves.toEqual([
      decision(),
      decision({ appeal: null }),
    ]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_frontend_decisions", {}, { get: false });
  });

  it("fails closed on a database error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(readMyFrontendDecisions(api, actor)).rejects.toThrow(
      "Account decisions are unavailable"
    );
  });

  it.each([
    ["decisions for another account", { account_id: uuid(2), items: [] }],
    ["an unknown decision kind", { account_id: actor, items: [decision({ kind: "fine" })] }],
    [
      "an unknown appeal status",
      {
        account_id: actor,
        items: [
          decision({
            appeal: { id: uuid(11), status: "pending", outcome: null, resolvedAt: null },
          }),
        ],
      },
    ],
    ["an extra decision field", { account_id: actor, items: [decision({ staff_note: "x" })] }],
    ["more than 100 decisions", { account_id: actor, items: Array(101).fill(decision()) }],
  ])("refuses %s", async (_label, data) => {
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(readMyFrontendDecisions(api, actor)).rejects.toThrow();
  });
});

const appeal = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: uuid(100 + n),
  decision_id: uuid(200 + n),
  appellant_id: uuid(300 + n),
  reason: "I was not the seller of that item at all.",
  kind: "ban",
  status: "submitted",
  created_at: at,
  reviewer_id: null,
  reviewer_rationale: null,
  resolved_at: null,
  effect_version: null,
  ends_at: null,
  decision_reason: "Fraud",
  can_resolve: true,
  ...overrides,
});

describe("readFrontendAppeals", () => {
  it("reads the submitted appeal queue for the signed-in reviewer", async () => {
    const data = { actor_id: actor, items: [appeal(1), appeal(2)], total: 2 };
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(readFrontendAppeals(api, actor)).resolves.toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_frontend_appeal_queue", {}, { get: false });
  });

  it("reads one appeal of any status by id", async () => {
    const one = appeal(1, { status: "upheld", reviewer_id: uuid(5), resolved_at: at });
    rpc.mockResolvedValueOnce({ data: { actor_id: actor, items: [one], total: 1 }, error: null });
    await expect(readFrontendAppeals(api, actor, one.id)).resolves.toMatchObject({ items: [one] });
    expect(rpc).toHaveBeenCalledWith(
      "get_frontend_appeal_queue",
      { p_appeal: one.id },
      { get: false }
    );
  });

  it("refuses a malformed appeal id before calling the database", async () => {
    await expect(readFrontendAppeals(api, actor, "not-a-uuid")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts a full first page of a longer queue", async () => {
    const items = Array.from({ length: 50 }, (_, n) => appeal(n));
    rpc.mockResolvedValueOnce({ data: { actor_id: actor, items, total: 80 }, error: null });
    await expect(readFrontendAppeals(api, actor)).resolves.toMatchObject({ total: 80 });
  });

  it.each([
    ["a queue for another reviewer", { actor_id: uuid(9), items: [appeal(1)], total: 1 }],
    ["fewer items than the total", { actor_id: actor, items: [appeal(1)], total: 2 }],
    [
      "a resolved appeal in the open queue",
      { actor_id: actor, items: [appeal(1, { status: "dismissed" })], total: 1 },
    ],
    [
      "an appeal reason shorter than twenty characters",
      { actor_id: actor, items: [appeal(1, { reason: "Not me" })], total: 1 },
    ],
    ["an extra field", { actor_id: actor, items: [appeal(1, { evidence: "x" })], total: 1 }],
  ])("refuses %s", async (_label, data) => {
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(readFrontendAppeals(api, actor)).rejects.toMatchObject({ status: 503 });
  });

  it("refuses a single read that returns a different appeal", async () => {
    rpc.mockResolvedValueOnce({
      data: { actor_id: actor, items: [appeal(2)], total: 1 },
      error: null,
    });
    await expect(readFrontendAppeals(api, actor, appeal(1).id)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("asks a reviewer to verify again when the database demands a second factor", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "second factor required" },
    });
    await expect(readFrontendAppeals(api, actor)).rejects.toMatchObject({
      status: 403,
      mfaRequired: true,
    });
  });
});
