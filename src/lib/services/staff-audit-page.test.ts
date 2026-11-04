/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readStaffAuditPage } from "./staff-audit-page";
import { readFoundationServerSession } from "../foundation/server-session";
import { FoundationStaffCommandError } from "../foundation/staff-command";
import { createAdminClient } from "../supabase/admin";
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`Redirect:${url}`);
  }),
}));
vi.mock("../foundation/server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("../supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired audit table queried");
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));
const actor = "11111111-1111-4111-8111-111111111111",
  target = "22222222-2222-4222-8222-222222222222",
  rpc = vi.fn();
const entry = {
  id: `governance_note:${target}`,
  occurred_at: "2026-11-04T22:00:00Z",
  actor_id: actor,
  actor_name: "Fixture reviewer",
  target_id: target,
  target_type: "case",
  action: "governance_approve",
  reason: "Independent evidence reviewed",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.mocked(readFoundationServerSession).mockResolvedValue({
    user: { id: actor },
    api: { rpc },
  } as unknown as Awaited<ReturnType<typeof readFoundationServerSession>>);
  rpc.mockResolvedValue({
    data: { account_id: actor, page: 1, limit: 50, total: 1, items: [entry] },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("maps protected native audit facts to the selected cards and filters without old table reads", async () => {
  const result = await readStaffAuditPage(
    {
      action: "governance_",
      actor,
      target,
      from: "2026-11-04",
      to: "2026-11-05",
      q: "evidence",
      type: "case",
    },
    1
  );
  expect(result.error).toBeNull();
  expect(result.total).toBe(1);
  expect(result.hasOlder).toBe(false);
  expect(result.actorMap.get(actor)).toBe("Fixture reviewer");
  expect(result.logs[0]).toMatchObject({
    id: entry.id,
    actor_id: actor,
    created_at: entry.occurred_at,
    reason: entry.reason,
    metadata: { target_id: target },
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "get_frontend_staff_audit_page",
    {
      p_request: {
        page: 1,
        action: "governance_",
        actor,
        target,
        from: "2026-11-04",
        to: "2026-11-05",
        q: "evidence",
        type: "case",
      },
    },
    { get: false }
  );
  expect(createAdminClient).not.toHaveBeenCalled();
});
it("retains the existing invalid-ID warning semantics by excluding invalid selectors only", async () => {
  expect(
    (await readStaffAuditPage({ actor: "not-an-id", target: "partial", q: "evidence" }, 1)).error
  ).toBeNull();
  expect(rpc).toHaveBeenCalledWith(
    "get_frontend_staff_audit_page",
    { p_request: { page: 1, q: "evidence" } },
    { get: false }
  );
});
it("treats failed, foreign or contradictory reads as unavailable rather than empty history", async () => {
  for (const response of [
    { data: null, error: { code: "XX000" } },
    { data: { account_id: target, page: 1, limit: 50, total: 1, items: [entry] }, error: null },
    { data: { account_id: actor, page: 1, limit: 50, total: 0, items: [entry] }, error: null },
  ]) {
    rpc.mockResolvedValueOnce(response);
    const result = await readStaffAuditPage({}, 1);
    expect(result.error).not.toBeNull();
    expect(result.logs).toEqual([]);
  }
});
it("returns to the selected audit filters after native authenticator confirmation", async () => {
  rpc.mockRejectedValueOnce(new FoundationStaffCommandError(403, "Authenticator required", true));
  await expect(readStaffAuditPage({ action: "governance_" }, 2)).rejects.toThrow("Redirect:");
  expect(redirect).toHaveBeenCalledWith(
    expect.stringContaining("next=%2Fadmin%2Faudit-log%3Faction%3Dgovernance_%26page%3D2")
  );
});
