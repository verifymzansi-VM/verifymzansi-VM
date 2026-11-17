import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { readFrontendEnforcement, readMyRestrictionStatus } from "./enforcement";
import { FoundationStaffCommandError } from "./staff-command";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uuid(1);
const at = "2026-11-10T08:00:00+02:00";
const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const item = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: uuid(100 + n),
  decision_id: uuid(200 + n),
  account_id: uuid(300 + n),
  kind: "suspension",
  reason: "Repeated misleading listings",
  starts_at: at,
  ends_at: at,
  emergency: false,
  version: 1,
  conflicted: false,
  display_name: "Thandi",
  ...overrides,
});
const page = (overrides: Record<string, unknown> = {}) => ({
  actor_id: actor,
  total: 2,
  suspensions: 1,
  bans: 1,
  emergency: 1,
  items: [item(1, { emergency: true }), item(2, { kind: "ban", ends_at: null })],
  recent: [{ id: "evt-1", action: "ban", account_id: uuid(302), reason: "Fraud", created_at: at }],
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("readFrontendEnforcement", () => {
  it("returns the caller's enforcement overview from the caller-bound read", async () => {
    rpc.mockResolvedValueOnce({ data: page(), error: null });
    await expect(readFrontendEnforcement(api, actor)).resolves.toEqual(page());
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_frontend_enforcement", {}, { get: false });
  });

  it("accepts a total larger than one page when exactly fifty items are shown", async () => {
    const items = Array.from({ length: 50 }, (_, n) => item(n));
    rpc.mockResolvedValueOnce({
      data: page({ total: 70, suspensions: 70, bans: 0, emergency: 0, items }),
      error: null,
    });
    await expect(readFrontendEnforcement(api, actor)).resolves.toMatchObject({ total: 70 });
  });

  it.each([
    ["an overview for another staff account", { actor_id: uuid(9) }],
    ["a total that is not suspensions plus bans", { total: 3, items: [item(1), item(2), item(3)] }],
    ["more emergencies than suspensions", { emergency: 2 }],
    ["fewer items than the total", { items: [item(1)] }],
    ["an unknown restriction kind", { items: [item(1), item(2, { kind: "warning" })] }],
    ["a reason shorter than ten characters", { items: [item(1), item(2, { reason: "short" })] }],
    ["an extra field", { raw_notes: "private" }],
    [
      "an unknown recent action",
      {
        recent: [{ id: "e", action: "delete", account_id: uuid(1), reason: "x", created_at: at }],
      },
    ],
  ])("refuses %s", async (_label, overrides) => {
    rpc.mockResolvedValueOnce({ data: page(overrides), error: null });
    await expect(readFrontendEnforcement(api, actor)).rejects.toMatchObject({
      status: 503,
      mfaRequired: false,
    });
  });

  it.each([
    [{ code: "42501", message: "second factor required" }, 403, true],
    [{ code: "42501", message: "not staff" }, 403, false],
    [{ code: "PT429" }, 429, false],
    [{ code: "XX000" }, 503, false],
  ])("maps database refusal %o to status %i", async (error, status, mfaRequired) => {
    rpc.mockResolvedValueOnce({ data: null, error });
    const failure = await readFrontendEnforcement(api, actor).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(FoundationStaffCommandError);
    expect(failure).toMatchObject({ status, mfaRequired });
  });
});

describe("readMyRestrictionStatus", () => {
  it.each([
    ["active", null],
    ["banned", null],
    ["suspended", at],
  ])("returns a %s status", async (status, ends_at) => {
    const data = { account_id: actor, status, ends_at };
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(readMyRestrictionStatus(api, actor)).resolves.toEqual(data);
    expect(rpc).toHaveBeenCalledWith("get_my_frontend_restriction_status", {}, { get: false });
  });

  it("returns null when the database refuses the caller", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(readMyRestrictionStatus(api, actor)).resolves.toBeNull();
  });

  it("fails closed on any other database error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    await expect(readMyRestrictionStatus(api, actor)).rejects.toThrow(
      "Restriction status unavailable"
    );
  });

  it.each([
    ["another account", { account_id: uuid(2), status: "active", ends_at: null }],
    ["a suspension without an end", { account_id: actor, status: "suspended", ends_at: null }],
    ["a ban with an end", { account_id: actor, status: "banned", ends_at: at }],
    ["an unknown status", { account_id: actor, status: "frozen", ends_at: null }],
    ["an extra field", { account_id: actor, status: "active", ends_at: null, reason: "x" }],
  ])("refuses a status for %s", async (_label, data) => {
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(readMyRestrictionStatus(api, actor)).rejects.toThrow();
  });
});
