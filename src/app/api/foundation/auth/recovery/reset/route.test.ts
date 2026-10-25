/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { FoundationPasswordUpdateError } from "@/lib/foundation/password-update";
const { context, authenticate, rpc, limit, breach, reset, notice } = vi.hoisted(() => ({
  context: vi.fn(),
  authenticate: vi.fn(),
  rpc: vi.fn(),
  limit: vi.fn(),
  breach: vi.fn(),
  reset: vi.fn(),
  notice: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({ url: "https://gntzjtuncsyefujajmjy.supabase.co" }),
}));
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: context }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: limit,
  getClientRateLimitIdentity: () => ({ key: "reset-ip" }),
}));
vi.mock("@/lib/security/pwned-passwords", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isPwnedPassword: breach,
}));
vi.mock("@/lib/services/email", () => ({ sendPasswordChangeNotification: notice }));
const id = "00000000-0000-4000-8000-000000000001",
  sid = "00000000-0000-4000-8000-000000000002";
const profile = {
  display_name: "Member",
  public_name: "Member",
  bio: null,
  avatar_object_id: null,
  legal_first_name: null,
  legal_last_name: null,
  legal_name_locked: false,
  identity_verified: false,
  revision: 1,
  updated_at: "2026-10-25T00:00:00Z",
};
const payload = {
  password: "synthetic-next-password",
  confirmPassword: "synthetic-next-password",
  recoverySessionId: sid,
};
const caller = () => ({
  accountId: id,
  user: { id, email: "member@example.invalid" },
  api: { rpc },
  recovery: { sessionId: sid, issuedAt: Math.floor(Date.now() / 1000) },
  resetPassword: reset,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "native-captcha");
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  context.mockReturnValue({
    authenticateCaller: authenticate,
    respond: async (response: Response) => response,
  });
  authenticate.mockResolvedValue(caller());
  rpc.mockResolvedValue({ data: profile, error: null });
  limit.mockResolvedValue({ limited: false });
  breach.mockResolvedValue(false);
  reset.mockResolvedValue({ signOutComplete: true });
  notice.mockResolvedValue({ success: true });
});
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown = payload, origin = "https://verifymzansi.com", proof = true) {
  const token = "a".repeat(64);
  return new NextRequest("https://verifymzansi.com/api/foundation/auth/recovery/reset", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(proof
        ? {
            cookie: `vm_csrf=${token}; sb-gntzjtuncsyefujajmjy-auth-token.0=synthetic`,
            "x-csrf-token": token,
          }
        : {}),
    },
    body: JSON.stringify(body),
  });
}
it("returns a private binding only for signed, live recovery", async () => {
  const response = await GET(request());
  expect(await response.json()).toEqual({ valid: true, recoverySessionId: sid, accountId: id });
  expect(reset).not.toHaveBeenCalled();
});
it("refuses an ordinary session even with client recovery markers", async () => {
  authenticate.mockResolvedValue({ ...caller(), recovery: null, resetPassword: null });
  expect(await (await GET(request())).json()).toEqual({ valid: false });
  expect((await POST(request({ ...payload, recovery: true }))).status).toBe(401);
  expect(reset).not.toHaveBeenCalled();
});
it("requires the live SQL session as well as a cryptographically valid token", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await POST(request())).status).toBe(401);
  expect(reset).not.toHaveBeenCalled();
});
it("rejects a form belonging to a different recovery session", async () => {
  expect((await POST(request({ ...payload, recoverySessionId: id }))).status).toBe(401);
  expect(breach).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
});
it.each([true, "unavailable"])(
  "does not reset when breach protection refuses %s",
  async (value) => {
    if (value === true) breach.mockResolvedValue(true);
    else breach.mockRejectedValue(new Error("unavailable"));
    expect((await POST(request())).status).toBe(value === true ? 400 : 503);
    expect(reset).not.toHaveBeenCalled();
  }
);
it("retains recovery for the genuine factor challenge when MFA is required", async () => {
  reset.mockRejectedValue(new FoundationPasswordUpdateError(403, "mfa_required"));
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "mfa_required" });
  expect(response.cookies.getAll()).toHaveLength(0);
});
it("clears session chunks only after the provider confirms revocation", async () => {
  const response = await POST(request());
  expect(await response.json()).toEqual({ success: true, signOutComplete: true });
  expect(response.cookies.get("sb-gntzjtuncsyefujajmjy-auth-token.0")?.maxAge).toBe(0);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledTimes(1);
});
it("does not repeat a successful update or erase the session needed to retry sign-out", async () => {
  reset.mockResolvedValue({ signOutComplete: false });
  const response = await POST(request());
  expect(await response.json()).toEqual({ success: true, signOutComplete: false });
  expect(response.cookies.getAll()).toHaveLength(0);
  expect(reset).toHaveBeenCalledTimes(1);
});
it.each([
  ["https://external.example", true],
  ["https://verifymzansi.com", false],
])("rejects untrusted mutation proof %s", async (origin, proof) => {
  expect((await POST(request(payload, origin, proof))).status).toBe(403);
  expect(authenticate).not.toHaveBeenCalled();
});
it("remains disabled during preparation", async () => {
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "");
  expect((await POST(request())).status).toBe(503);
  expect(context).not.toHaveBeenCalled();
});
