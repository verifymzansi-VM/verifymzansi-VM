import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type * as AdminAccess from "@/lib/auth/admin-access";
import type { StaffAccess } from "@/lib/auth/admin-access";

const { authenticateStaffRequest, readStaffAccessFromDb, checkStaffApiMfa, rateLimit } = vi.hoisted(
  () => ({
    authenticateStaffRequest: vi.fn(),
    readStaffAccessFromDb: vi.fn(),
    checkStaffApiMfa: vi.fn(),
    rateLimit: vi.fn(),
  })
);

vi.mock("@/lib/auth/staff-session", () => ({ authenticateStaffRequest }));
vi.mock("@/lib/auth/admin-access", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminAccess>()),
  readStaffAccessFromDb,
}));
vi.mock("@/lib/auth/staff-mfa-guard", () => ({ checkStaffApiMfa }));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: () => null }));
vi.mock("@/lib/utils/mutation-origin", () => ({ enforceSameOriginMutation: () => null }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkLocalRateLimit: rateLimit }));

import { enforceAdminMutationGuard } from "./admin-route-guard";

const accountId = "11111111-1111-4111-8111-111111111111";
const api = { rpc: vi.fn() };
const respond = vi.fn(async (response: NextResponse) => {
  response.headers.set("x-responded", "1");
  return response;
});
const access = (overrides: Partial<StaffAccess> = {}): StaffAccess => ({
  role: "moderator",
  capabilities: ["queue:claim", "queue:view"],
  canAccess: true,
  totpEnrolled: true,
  ...overrides,
});
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const guard = (extra: Record<string, unknown> = {}) =>
  enforceAdminMutationGuard({
    request: new Request("https://verifymzansi.com/api/admin/x", { method: "POST" }),
    logger,
    rateLimitAction: "admin:test",
    ...extra,
  });

describe("enforceAdminMutationGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateStaffRequest.mockResolvedValue({
      ok: true,
      respond,
      caller: { api, accountId, user: { id: accountId }, authenticatorAt: 1_790_000_000 },
    });
    readStaffAccessFromDb.mockResolvedValue(access());
    checkStaffApiMfa.mockResolvedValue(null);
    rateLimit.mockReturnValue({ limited: false });
  });

  it("returns the database-verified role, the caller's API and respond", async () => {
    await expect(guard()).resolves.toEqual({
      success: true,
      user: { id: accountId },
      actorRole: "moderator",
      api,
      respond,
    });
    expect(readStaffAccessFromDb).toHaveBeenCalledExactlyOnceWith(api);
    expect(checkStaffApiMfa).toHaveBeenCalledWith(
      { access: access(), accountId, authenticatorAt: 1_790_000_000 },
      { stepUp: false }
    );
    expect(rateLimit).toHaveBeenCalledWith(accountId, "admin:test");
  });

  it("checks the capability against the database's assignment", async () => {
    const result = await guard({ capability: "decision:approve", forbiddenMessage: "No" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.response.status).toBe(403);
    expect(result.response.headers.get("x-responded")).toBe("1");
    expect(checkStaffApiMfa).not.toHaveBeenCalled();
    await expect(guard({ capability: "queue:claim" })).resolves.toMatchObject({ success: true });
  });

  it("limits adminOnly routes to administrators", async () => {
    expect((await guard({ adminOnly: true })).success).toBe(false);
    readStaffAccessFromDb.mockResolvedValue(access({ role: "admin" }));
    await expect(guard({ adminOnly: true })).resolves.toMatchObject({
      success: true,
      actorRole: "admin",
    });
  });

  it("refuses callers the database does not list as staff", async () => {
    readStaffAccessFromDb.mockResolvedValue(null);
    const result = await guard();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.response.status).toBe(403);
    expect(checkStaffApiMfa).not.toHaveBeenCalled();
  });

  it("returns the MFA refusal before rate limiting", async () => {
    const refusal = NextResponse.json({ code: "step_up_required" }, { status: 403 });
    checkStaffApiMfa.mockResolvedValue(refusal);

    const result = await guard({ stepUp: true });

    expect(result).toEqual({ success: false, response: refusal });
    expect(respond).toHaveBeenCalledWith(refusal);
    expect(checkStaffApiMfa).toHaveBeenCalledWith(expect.anything(), { stepUp: true });
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("rate limits per account", async () => {
    rateLimit.mockReturnValue({ limited: true, retryAfter: 30 });
    const result = await guard();
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("30");
  });

  it("refuses signed-out callers without touching the database", async () => {
    const refusal = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    authenticateStaffRequest.mockResolvedValue({ ok: false, response: refusal });
    const result = await guard();
    expect(result).toEqual({ success: false, response: refusal });
    expect(readStaffAccessFromDb).not.toHaveBeenCalled();
  });
});
