import { beforeEach, describe, expect, it, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

import { getMemberDecisions } from "./member-decisions";

/** A chainable query stub that resolves to `data` whatever filters are applied. */
function query(data: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) q[m] = vi.fn(() => q);
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
  return q;
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

function tables(t: Record<string, unknown[]>) {
  from.mockImplementation((name: string) => query(t[name] ?? []));
}

describe("getMemberDecisions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists restrictions and hidden content with their appeal state", async () => {
    tables({
      account_restrictions: [
        {
          decision_id: "d-ban",
          kind: "ban",
          reason: "Fraud",
          starts_at: "2026-09-01T00:00:00Z",
          ends_at: null,
          lifted_at: null,
        },
        {
          decision_id: "d-sus",
          kind: "suspension",
          reason: "Spam",
          starts_at: "2026-08-01T00:00:00Z",
          ends_at: FUTURE,
          lifted_at: "2026-08-02T00:00:00Z",
        },
      ],
      content_effects: [
        { decision_id: "d-hide", applied_at: "2026-09-10T00:00:00Z", reverted_at: null },
      ],
      decision_records: [
        {
          id: "d-ban",
          status: "approved",
          action_category: "account_ban",
          recommendation: "ban",
          rationale: "Fraud",
        },
        {
          id: "d-sus",
          status: "approved",
          action_category: "account_suspend",
          recommendation: "suspend",
          rationale: "Spam",
        },
        {
          id: "d-hide",
          status: "approved",
          action_category: "content_removal",
          recommendation: "hide",
          rationale: "Misleading price",
        },
      ],
      appeal_cases: [
        {
          id: "a-1",
          decision_id: "d-sus",
          status: "overturned",
          reviewer_rationale: "Proof accepted",
          resolved_at: "2026-08-02T00:00:00Z",
        },
      ],
    });

    const result = await getMemberDecisions("member-1");

    expect(result.map((d) => d.decisionId)).toEqual(["d-hide", "d-ban", "d-sus"]);
    expect(result[0]).toMatchObject({
      kind: "content_hidden",
      reason: "Misleading price",
      active: true,
      appealable: true,
    });
    expect(result[1]).toMatchObject({ kind: "ban", active: true, appealable: true, appeal: null });
    expect(result[2]).toMatchObject({
      kind: "suspension",
      active: false,
      appealable: false,
      appeal: { id: "a-1", status: "overturned", outcome: "Proof accepted" },
    });
  });

  it("does not offer an appeal for lifts or overridden decisions", async () => {
    tables({
      account_restrictions: [
        {
          decision_id: "d-1",
          kind: "ban",
          reason: "x",
          starts_at: "2026-09-01T00:00:00Z",
          ends_at: null,
          lifted_at: "2026-09-02T00:00:00Z",
        },
      ],
      decision_records: [
        { id: "d-1", status: "overridden", action_category: "account_ban", recommendation: "ban" },
      ],
    });
    const [decision] = await getMemberDecisions("member-1");
    expect(decision.appealable).toBe(false);
  });

  it("returns nothing, without further queries, when the account has no decisions", async () => {
    tables({});
    await expect(getMemberDecisions("member-1")).resolves.toEqual([]);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("throws instead of showing a false empty list", async () => {
    from.mockImplementation(() => {
      const q = query([]);
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: { message: "down" } });
      return q;
    });
    await expect(getMemberDecisions("member-1")).rejects.toThrow("Could not load decisions");
  });
});
