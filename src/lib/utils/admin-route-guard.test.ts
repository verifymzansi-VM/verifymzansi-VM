import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { getUser, verifyStaff, verifyCapability, verifyAdmin, checkStaffApiMfa, rateLimit } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    verifyStaff: vi.fn(),
    verifyCapability: vi.fn(),
    verifyAdmin: vi.fn(),
    checkStaffApiMfa: vi.fn(),
    rateLimit: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: verifyStaff,
  verifyCapabilityRoleFromDb: verifyCapability,
  verifyAdminActorRoleFromDb: verifyAdmin,
}));
vi.mock("@/lib/auth/staff-mfa-guard", () => ({ checkStaffApiMfa }));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: () => null }));
vi.mock("@/lib/utils/mutation-origin", () => ({ enforceSameOriginMutation: () => null }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkLocalRateLimit: rateLimit }));

import { enforceAdminMutationGuard } from "./admin-route-guard";

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
    getUser.mockResolvedValue({ data: { user: { id: "staff-1" } } });
    verifyStaff.mockResolvedValue("moderator");
    verifyCapability.mockResolvedValue("governance_controller");
    checkStaffApiMfa.mockResolvedValue(null);
    rateLimit.mockReturnValue({ limited: false });
  });

  it("returns the database-verified role when every check passes", async () => {
    await expect(guard()).resolves.toMatchObject({ success: true, actorRole: "moderator" });
    expect(checkStaffApiMfa).toHaveBeenCalledWith(expect.anything(), "staff-1", { stepUp: false });
  });

  it("checks the capability against the database role", async () => {
    verifyCapability.mockResolvedValue(null);
    const result = await guard({ capability: "decision:approve" });
    expect(result.success).toBe(false);
    expect(checkStaffApiMfa).not.toHaveBeenCalled();
  });

  it("returns the MFA refusal before rate limiting", async () => {
    const refusal = NextResponse.json({ code: "step_up_required" }, { status: 403 });
    checkStaffApiMfa.mockResolvedValue(refusal);

    const result = await guard({ stepUp: true });

    expect(result).toEqual({ success: false, response: refusal });
    expect(checkStaffApiMfa).toHaveBeenCalledWith(expect.anything(), "staff-1", { stepUp: true });
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("refuses signed-out callers without touching the database", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const result = await guard();
    expect(result.success).toBe(false);
    expect(verifyStaff).not.toHaveBeenCalled();
  });
});
