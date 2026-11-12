import { describe, expect, it, vi } from "vitest";
import { readRestoredStaffRoles } from "./staff-role-review";
import { FoundationStaffCommandError } from "./staff-command";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uuid(1);
const at = "2026-11-10T08:00:00+02:00";
const change = { id: uuid(10), target_id: uuid(11), from_role: "member", to_role: "moderator" };
const review = (overrides: Record<string, unknown> = {}) => ({
  actor_id: actor,
  staff_total: 2,
  staff: [
    { user_id: uuid(2), role: "admin", granted_at: at, mfa_required_after: null },
    { user_id: uuid(3), role: "moderator", granted_at: at, mfa_required_after: at },
  ],
  pending: [
    {
      ...change,
      reason: "Covers weekend queue",
      proposer_id: uuid(2),
      created_at: at,
      expires_at: at,
    },
  ],
  history: [{ ...change, reason: "Earlier change", reviewer_id: uuid(3), decided_at: at }],
  people: [{ user_id: uuid(11), email: "member@example.test", display_name: null }],
  ...overrides,
});
const apiReturning = (result: { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async () => result);
  return { api: { rpc } as unknown as FoundationAuthenticatedApi, rpc };
};

describe("readRestoredStaffRoles", () => {
  it("reads one page of staff, pending changes and history for the signed-in actor", async () => {
    const { api, rpc } = apiReturning({ data: review(), error: null });
    await expect(readRestoredStaffRoles(api, actor, 1)).resolves.toEqual(review());
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_frontend_staff_role_review",
      { p_page: 1 },
      { get: false }
    );
  });

  it("passes a staff role filter and refuses member as a filter", async () => {
    const { api, rpc } = apiReturning({ data: review(), error: null });
    await readRestoredStaffRoles(api, actor, 1, "governor");
    expect(rpc).toHaveBeenCalledWith(
      "get_frontend_staff_role_review",
      { p_page: 1, p_role: "governor" },
      { get: false }
    );
    expect(() => readRestoredStaffRoles(api, actor, 1, "member")).toThrow();
  });

  it.each([
    ["a review for another account", { actor_id: uuid(9) }],
    [
      "an unknown role",
      // staff_total matches the one row, so only the role check can refuse it.
      {
        staff_total: 1,
        staff: [{ user_id: uuid(2), role: "owner", granted_at: at, mfa_required_after: null }],
      },
    ],
    ["an extra field", { raw_evidence: "secret" }],
    [
      "a reason shorter than five characters",
      { history: [{ ...change, reason: "ok", reviewer_id: null, decided_at: at }] },
    ],
    ["a page whose size does not match the total", { staff_total: 5 }],
  ])("refuses %s instead of showing it", async (_label, overrides) => {
    const { api } = apiReturning({ data: review(overrides), error: null });
    await expect(readRestoredStaffRoles(api, actor, 1)).rejects.toMatchObject({ status: 503 });
  });

  it("accepts an empty later page", async () => {
    const { api } = apiReturning({ data: review({ staff_total: 50, staff: [] }), error: null });
    await expect(readRestoredStaffRoles(api, actor, 2)).resolves.toMatchObject({ staff: [] });
  });

  it("asks for a fresh authenticator when the database demands it", async () => {
    const { api } = apiReturning({
      data: null,
      error: { code: "42501", message: "a second factor is required" },
    });
    const refused = readRestoredStaffRoles(api, actor, 1);
    await expect(refused).rejects.toBeInstanceOf(FoundationStaffCommandError);
    await expect(refused).rejects.toMatchObject({ status: 403, mfaRequired: true });
  });
});
