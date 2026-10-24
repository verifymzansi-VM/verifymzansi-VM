/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { POST as compatibilityPOST } from "@/app/api/auth/change-password/route";
import { CSRF_HEADER_NAME } from "@/lib/utils/csrf";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { FoundationPasswordUpdateError } from "@/lib/foundation/password-update";
const { authenticate, context, readAccount, limit, breach, update, notice, legacy } = vi.hoisted(
  () => ({
    authenticate: vi.fn(),
    context: vi.fn(),
    readAccount: vi.fn(),
    limit: vi.fn(),
    breach: vi.fn(),
    update: vi.fn(),
    notice: vi.fn(),
    legacy: vi.fn(),
  })
);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: legacy, createPublicClient: legacy }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: context }));
vi.mock("@/lib/foundation/account-context", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountContext: readAccount,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: limit,
  getClientRateLimitIdentity: () => ({ key: "synthetic-ip" }),
  getClientIp: () => "synthetic-ip",
}));
vi.mock("@/lib/security/pwned-passwords", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isPwnedPassword: breach,
}));
vi.mock("@/lib/services/email", () => ({ sendPasswordChangeNotification: notice }));
const id = "00000000-0000-4000-8000-000000000001";
const payload = {
  currentPassword: "synthetic-current",
  newPassword: "synthetic-next-password",
  confirmNewPassword: "synthetic-next-password",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "native-captcha");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  context.mockReturnValue({
    authenticateCaller: authenticate,
    respond: async (response: Response) => response,
  });
  authenticate.mockResolvedValue({
    accountId: id,
    user: { id, email: "member@example.invalid" },
    api: {},
    updatePassword: update,
  });
  readAccount.mockResolvedValue({ account_id: id, staff: null });
  limit.mockResolvedValue({ limited: false });
  breach.mockResolvedValue(false);
  update.mockResolvedValue(undefined);
  notice.mockResolvedValue({ success: true });
});
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown = payload, origin = "https://verifymzansi.com", csrf = true) {
  const token = "d".repeat(64);
  return new NextRequest("https://verifymzansi.com/api/foundation/auth/password", {
    method: "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      ...(csrf ? { cookie: `vm_csrf=${token}`, [CSRF_HEADER_NAME]: token } : {}),
    },
    body: JSON.stringify(body),
  });
}
it("stays unavailable before native Auth is enabled", async () => {
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "");
  expect((await POST(request())).status).toBe(503);
  expect(context).not.toHaveBeenCalled();
});
it.each([
  ["https://external.example", true],
  ["https://verifymzansi.com", false],
])("refuses untrusted request proof before credentials are inspected %s", async (origin, csrf) => {
  expect((await POST(request(payload, origin, csrf))).status).toBe(403);
  expect(context).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
it("requires a verified account session", async () => {
  authenticate.mockRejectedValue(new FoundationSessionError(401));
  expect((await POST(request())).status).toBe(401);
  expect(breach).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
it("checks canonical identity, account protection and breach status before one update", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(limit).toHaveBeenLastCalledWith({
    key: "account:" + id,
    action: "auth:change-password",
    degradedMode: "block",
  });
  expect(update).toHaveBeenCalledWith(payload.currentPassword, payload.newPassword);
  expect(update).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledWith("member@example.invalid");
});
it.each([true, "unavailable"])(
  "does not update when breach protection refuses: %s",
  async (result) => {
    if (result === true) breach.mockResolvedValue(true);
    else breach.mockRejectedValue(new Error("unavailable"));
    expect((await POST(request())).status).toBe(result === true ? 400 : 503);
    expect(update).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  }
);
it("refuses actor selectors rather than stripping them", async () => {
  expect((await POST(request({ ...payload, owner_id: id }))).status).toBe(400);
  expect(update).not.toHaveBeenCalled();
});
it("requires a fresh staff factor and ignores a different account result", async () => {
  readAccount.mockResolvedValueOnce({ account_id: id, staff: { can_access: false } });
  expect((await POST(request())).status).toBe(403);
  readAccount.mockResolvedValueOnce({ account_id: "different", staff: null });
  expect((await POST(request())).status).toBe(503);
  expect(update).not.toHaveBeenCalled();
});
it("blocks when the shared protection is degraded", async () => {
  limit.mockResolvedValue({ limited: true, degraded: true });
  expect((await POST(request())).status).toBe(503);
  expect(update).not.toHaveBeenCalled();
});
it("preserves the provider MFA refusal", async () => {
  update.mockRejectedValue(new FoundationPasswordUpdateError(403, "mfa_required"));
  expect((await POST(request())).status).toBe(403);
  expect(notice).not.toHaveBeenCalled();
});
it("does not repeat a committed update when its security notification is unavailable", async () => {
  notice.mockRejectedValue(new Error("unavailable"));
  expect((await POST(request())).status).toBe(200);
  expect(update).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledTimes(1);
});
it("routes the older password URL to the same native handler without legacy sign-in", async () => {
  expect((await compatibilityPOST(request())).status).toBe(200);
  expect(update).toHaveBeenCalledTimes(1);
  expect(legacy).not.toHaveBeenCalled();
});
