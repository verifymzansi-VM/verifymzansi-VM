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
it.each([
  ["a live recovery session", { recovery: { sessionId: id, issuedAt: 1 } }],
  ["a session opened by a reset link over an hour ago", { recovery: null, openedByRecovery: true }],
])("refuses %s before any password check", async (_label, session) => {
  authenticate.mockResolvedValue({ ...(await authenticate()), ...session });
  const response = await POST(request({ ...payload, currentPassword: "synthetic-wrong" }));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Use the reset link from your email to set a new password",
    reason: "recovery_session",
  });
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(readAccount).not.toHaveBeenCalled();
  expect(breach).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(notice).not.toHaveBeenCalled();
  // The older password URL refuses it the same way.
  expect((await compatibilityPOST(request())).status).toBe(403);
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
  expect(update).toHaveBeenCalledWith(
    payload.currentPassword,
    payload.newPassword,
    expect.any(Function)
  );
  expect(update).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledWith("member@example.invalid");
  // The updater spends the account's own budget for current-password checks.
  limit.mockClear();
  await update.mock.calls[0][2]();
  expect(limit).toHaveBeenCalledExactlyOnceWith({
    key: "account:" + id,
    action: "auth:change-password:verify",
    degradedMode: "block",
  });
});
it.each([
  [{ limited: true }, 429, "Too many attempts; try again later"],
  [{ limited: true, degraded: true }, 503, "Password change could not be confirmed"],
])(
  "refuses when the account's current-password check budget refuses (%o)",
  async (refusal, status, error) => {
    let checked = false;
    update.mockImplementation(
      async (_current: string, _next: string, charge: () => Promise<void>) => {
        await charge();
        checked = true;
      }
    );
    limit.mockImplementation(async ({ action }: { action: string }) =>
      action === "auth:change-password:verify" ? refusal : { limited: false }
    );
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error, reason: "unavailable" });
    expect(checked).toBe(false);
    expect(notice).not.toHaveBeenCalled();
  }
);
it("answers a wrong current password from the server's own check in the page's terms", async () => {
  update.mockRejectedValue(new FoundationPasswordUpdateError(400, "current_password"));
  for (const send of [POST, compatibilityPOST]) {
    const response = await send(request({ ...payload, currentPassword: "synthetic-wrong" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Current password is incorrect",
      reason: "current_password",
    });
  }
  expect(notice).not.toHaveBeenCalled();
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
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Confirm your authenticator code before changing your password",
    reason: "mfa_required",
    code: "mfa_required",
  });
  expect(notice).not.toHaveBeenCalled();
});
it("tells the profile page to offer a fresh sign-in when Auth asks for reauthentication", async () => {
  update.mockRejectedValue(new FoundationPasswordUpdateError(401, "reauthentication"));
  for (const send of [POST, compatibilityPOST]) {
    const response = await send(request());
    expect(response.status).toBe(401);
    // `code` is what the restored page reads; `reason` stays for other callers.
    expect(await response.json()).toEqual({
      error: "Sign out, then sign in again before changing your password",
      reason: "reauthentication",
      code: "reauthentication_required",
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
  expect(update).toHaveBeenCalledTimes(2);
  expect(notice).not.toHaveBeenCalled();
});
it("asks staff without a fresh authenticator step for it in the page's terms", async () => {
  readAccount.mockResolvedValueOnce({ account_id: id, staff: { can_access: false } });
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Confirm your authenticator code before changing your password",
    reason: "mfa_required",
    code: "mfa_required",
  });
  expect(update).not.toHaveBeenCalled();
});
it.each([
  [new FoundationPasswordUpdateError(400, "current_password"), 400, "current_password"],
  [new FoundationPasswordUpdateError(400, "password_policy"), 400, "password_policy"],
  [new FoundationPasswordUpdateError(503, "unavailable"), 503, "unavailable"],
])("adds no page code to other refusals (%s)", async (error, status, reason) => {
  update.mockRejectedValue(error);
  const response = await POST(request());
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body.reason).toBe(reason);
  expect(body).not.toHaveProperty("code");
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
