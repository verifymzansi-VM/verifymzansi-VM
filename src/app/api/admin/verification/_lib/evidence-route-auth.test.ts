import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), role: vi.fn(), mfa: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/auth/admin-access", () => ({ verifyStaffActorRoleFromDb: mocks.role }));
vi.mock("@/lib/auth/staff-mfa-guard", () => ({ checkStaffApiMfa: mocks.mfa }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkSensitiveActionRateLimit: mocks.rate }));
import { authorizeEvidenceRequest } from "./evidence-route-auth";
const params = {
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  rateLimitAction: "synthetic:evidence",
};
describe("raw identity evidence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "synthetic-user" } }, error: null });
    mocks.role.mockResolvedValue("moderator");
    mocks.mfa.mockResolvedValue(null);
    mocks.rate.mockResolvedValue({ limited: false });
  });
  it("requires a fresh second factor for legitimate staff", async () => {
    expect((await authorizeEvidenceRequest(params)).success).toBe(true);
    expect(mocks.mfa).toHaveBeenCalledWith(expect.anything(), "synthetic-user", { stepUp: true });
  });
  it("rejects grace/stale-factor denial before reading evidence", async () => {
    mocks.mfa.mockResolvedValue(NextResponse.json({ code: "step_up_required" }, { status: 403 }));
    const result = await authorizeEvidenceRequest(params);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.response.status).toBe(403);
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it("rejects ordinary or revoked staff roles before MFA", async () => {
    mocks.role.mockResolvedValue(null);
    expect((await authorizeEvidenceRequest(params)).success).toBe(false);
    expect(mocks.mfa).not.toHaveBeenCalled();
  });
  it("rejects an unauthenticated or expired Auth session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await authorizeEvidenceRequest(params);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.response.status).toBe(401);
    expect(mocks.role).not.toHaveBeenCalled();
  });
});
