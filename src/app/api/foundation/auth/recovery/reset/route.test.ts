/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import {
  FoundationPasswordResetUncertainError,
  FoundationPasswordUpdateError,
} from "@/lib/foundation/password-update";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { PWNED_PASSWORD_ERROR } from "@/lib/security/pwned-passwords";
import { sealRecoveryBinding } from "@/lib/foundation/recovery-binding";
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
  sid = "00000000-0000-4000-8000-000000000002",
  otherSid = "00000000-0000-4000-8000-000000000003",
  otherId = "00000000-0000-4000-8000-000000000004";
const APP = "https://verifymzansi.com";
const BINDING = "__Host-vm_recovery_binding";
const CHANGED = { error: "Your recovery session changed. Check the link again." };
const NEW_LINK = { error: "Request a new recovery link" };
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
/** What the restored reset page sends: the two passwords only. */
const payload = {
  password: "synthetic-next-password",
  confirmPassword: "synthetic-next-password",
};
const seconds = () => Math.floor(Date.now() / 1000);
const caller = () => ({
  accountId: id,
  user: { id, email: "member@example.invalid" },
  api: { rpc },
  recovery: { sessionId: sid, issuedAt: seconds() },
  resetPassword: reset,
});
/** A binding as the recovery callback writes it when a link is opened. */
function opened(accountId = id, sessionId = sid, at = seconds()) {
  return sealRecoveryBinding({ accountId, sessionId, issuedAt: at }, at);
}
const page = (marker: string) => `${APP}/reset-password?link=${marker}`;
let link: ReturnType<typeof opened>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "native-captcha");
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
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
  link = opened();
});
afterEach(() => vi.unstubAllEnvs());
function request(
  body: unknown = payload,
  origin = APP,
  proof = true,
  {
    binding = link.value as string | null,
    referer = page(link.marker) as string | null,
  }: { binding?: string | null; referer?: string | null } = {}
) {
  const token = "a".repeat(64);
  const cookies = [
    ...(proof ? [`vm_csrf=${token}`, "sb-gntzjtuncsyefujajmjy-auth-token.0=synthetic"] : []),
    ...(binding === null ? [] : [`${BINDING}=${binding}`]),
  ];
  return new NextRequest(`${APP}/api/foundation/auth/recovery/reset`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
      ...(proof ? { "x-csrf-token": token } : {}),
      ...(referer === null ? {} : { referer }),
    },
    body: JSON.stringify(body),
  });
}
function check(options?: Parameters<typeof request>[3]) {
  const post = request(payload, APP, true, options);
  return new NextRequest(post.url, { method: "GET", headers: post.headers });
}
it("returns a private binding only for signed, live recovery", async () => {
  const response = await GET(check());
  // Only the answer: no session or account id reaches the page.
  expect(await response.json()).toEqual({ valid: true });
  expect(reset).not.toHaveBeenCalled();
});
it("refuses an ordinary session even with client recovery markers", async () => {
  authenticate.mockResolvedValue({ ...caller(), recovery: null, resetPassword: null });
  expect(await (await GET(check())).json()).toEqual({ valid: false });
  expect((await POST(request({ ...payload, recovery: true }))).status).toBe(401);
  expect(reset).not.toHaveBeenCalled();
});
it("requires the live SQL session as well as a cryptographically valid token", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await POST(request())).status).toBe(401);
  expect(reset).not.toHaveBeenCalled();
});

it("completes the restored page's two-field form from the server-side binding", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, signOutComplete: true });
  expect(reset).toHaveBeenCalledWith(payload.password);
  expect(breach).toHaveBeenCalledWith(payload.password);
});
it("still accepts a client that sends the live recovery session id", async () => {
  const response = await POST(request({ ...payload, recoverySessionId: sid }));
  expect(response.status).toBe(200);
  expect(reset).toHaveBeenCalledTimes(1);
});
it("rejects a form belonging to a different recovery session", async () => {
  const response = await POST(request({ ...payload, recoverySessionId: otherSid }));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual(CHANGED);
  expect(breach).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
});

it.each([
  ["no binding (the link was not opened in this browser)", null],
  ["a changed payload", (value: string) => "e30" + value.slice(3)],
  [
    "a changed signature",
    (value: string) => value.slice(0, -2) + (value.endsWith("AA") ? "BB" : "AA"),
  ],
  ["a binding that expired", (_value: string) => opened(id, sid, seconds() - 3000).value],
] as const)("refuses %s", async (_label, change) => {
  const binding = change === null ? null : change(link.value);
  expect(await (await GET(check({ binding }))).json()).toEqual({ valid: false });
  const response = await POST(request(payload, APP, true, { binding }));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual(NEW_LINK);
  expect(breach).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
});

it("link A, then link B, then form A: refused as a changed recovery session", async () => {
  // Link A opened page A; link B, opened later in the same browser, replaced
  // the binding and the session cookies. Page A still shows its form.
  const linkA = link;
  const linkB = opened(id, otherSid);
  authenticate.mockResolvedValue({
    ...caller(),
    recovery: { sessionId: otherSid, issuedAt: seconds() },
  });
  const formA = await POST(
    request(payload, APP, true, { binding: linkB.value, referer: page(linkA.marker) })
  );
  expect(formA.status).toBe(401);
  expect(await formA.json()).toEqual(CHANGED);
  expect(
    await (await GET(check({ binding: linkB.value, referer: page(linkA.marker) }))).json()
  ).toEqual({ valid: false });
  expect(breach).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
  // Page B, opened by the latest link, still completes.
  const formB = await POST(
    request(payload, APP, true, { binding: linkB.value, referer: page(linkB.marker) })
  );
  expect(formB.status).toBe(200);
  expect(reset).toHaveBeenCalledTimes(1);
});
it("refuses when the session cookies changed but the binding did not", async () => {
  authenticate.mockResolvedValue({
    ...caller(),
    recovery: { sessionId: otherSid, issuedAt: seconds() },
  });
  expect(await (await GET(check())).json()).toEqual({ valid: false });
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual(CHANGED);
  expect(reset).not.toHaveBeenCalled();
});
it("refuses a binding issued to another account", async () => {
  const foreign = opened(otherId);
  const options = { binding: foreign.value, referer: page(foreign.marker) };
  expect(await (await GET(check(options))).json()).toEqual({ valid: false });
  const response = await POST(request(payload, APP, true, options));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual(CHANGED);
  expect(reset).not.toHaveBeenCalled();
});
it.each([
  [
    "a repeated marker",
    `${APP}/reset-password?link=AAAAAAAAAAAAAAAAAAAAAA&link=BBBBBBBBBBBBBBBBBBBBBB`,
  ],
  ["a malformed marker", `${APP}/reset-password?link=x`],
  ["no marker", `${APP}/reset-password`],
  ["another page", `${APP}/login?link=AAAAAAAAAAAAAAAAAAAAAA`],
  ["another site", "https://other.example/reset-password?link=AAAAAAAAAAAAAAAAAAAAAA"],
  ["an unreadable address", "not a url"],
  ["an address that is too long", `${APP}/reset-password?pad=${"x".repeat(2100)}`],
])("refuses a reset page with %s", async (_label, referer) => {
  const response = await POST(request(payload, APP, true, { referer }));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual(CHANGED);
  expect(reset).not.toHaveBeenCalled();
});
it.each([
  ["no page address", null],
  ["a page address trimmed to the bare origin", `${APP}/`],
])("falls back to the session binding when the browser sends %s", async (_label, referer) => {
  expect((await POST(request(payload, APP, true, { referer }))).status).toBe(200);
  expect(reset).toHaveBeenCalledTimes(1);
});
it("accepts the reset page with a trailing slash and on the request's own host", async () => {
  expect(
    (
      await POST(
        request(payload, APP, true, { referer: `${APP}/reset-password/?link=${link.marker}` })
      )
    ).status
  ).toBe(200);
  const www = "https://www.verifymzansi.com";
  const post = request(payload, www, true, {
    referer: `${www}/reset-password?link=${link.marker}`,
  });
  const response = await POST(
    new NextRequest(`${www}/api/foundation/auth/recovery/reset`, {
      method: "POST",
      headers: post.headers,
      body: JSON.stringify(payload),
    })
  );
  expect(response.status).toBe(200);
  expect(reset).toHaveBeenCalledTimes(2);
});
it.each([
  [true, "We could not confirm your new password. Try signing in with it, or request a new link."],
  [false, "We could not confirm your new password. Please try again."],
] as const)(
  "signs out and tells the member when a reset's outcome is unknown (signed out: %s)",
  async (signedOut, message) => {
    reset.mockRejectedValue(new FoundationPasswordResetUncertainError(signedOut));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: message, code: "recovery_unconfirmed" });
    // The owner is told about a change that may have happened.
    expect(notice).toHaveBeenCalledTimes(1);
    if (signedOut) {
      // The session is gone, so the link is spent.
      expect(response.cookies.get(BINDING)?.maxAge).toBe(0);
      expect(response.cookies.get("sb-gntzjtuncsyefujajmjy-auth-token.0")?.maxAge).toBe(0);
    } else {
      // The same form can be sent again with the same link.
      expect(response.cookies.getAll()).toHaveLength(0);
    }
    expect(reset).toHaveBeenCalledTimes(1);
  }
);
it("completes when a retry finds the new password already in force", async () => {
  reset.mockResolvedValue({ signOutComplete: true, alreadyCurrent: true });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, signOutComplete: true });
  expect(response.cookies.get(BINDING)?.maxAge).toBe(0);
  expect(response.cookies.get("sb-gntzjtuncsyefujajmjy-auth-token.0")?.maxAge).toBe(0);
  expect(notice).toHaveBeenCalledTimes(1);
});

it("one opened link completes at most one reset", async () => {
  const first = await POST(request());
  expect(first.status).toBe(200);
  expect(first.cookies.get(BINDING)).toMatchObject({
    value: "",
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
  });
  // The browser drops the binding; the same session cannot reset again.
  const again = await POST(request(payload, APP, true, { binding: null }));
  expect(again.status).toBe(401);
  expect(await again.json()).toEqual(NEW_LINK);
  // A kept copy of the binding is useless once the session was signed out.
  authenticate.mockRejectedValue(new FoundationSessionError(401));
  const replay = await POST(request());
  expect(replay.status).toBe(401);
  expect(await replay.json()).toEqual(NEW_LINK);
  expect(reset).toHaveBeenCalledTimes(1);
});
it.each([true, "unavailable"])(
  "does not reset when breach protection refuses %s",
  async (value) => {
    if (value === true) breach.mockResolvedValue(true);
    else breach.mockRejectedValue(new Error("unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(value === true ? 400 : 503);
    if (value === true) expect(await response.json()).toEqual({ error: PWNED_PASSWORD_ERROR });
    // The member can choose another password with the same link.
    expect(response.cookies.get(BINDING)).toBeUndefined();
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
it("refuses a recovery method older than its window even with a live binding", async () => {
  reset.mockRejectedValue(new FoundationPasswordUpdateError(401, "reauthentication"));
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(response.cookies.get(BINDING)).toBeUndefined();
});
it("clears session chunks only after the provider confirms revocation", async () => {
  const response = await POST(request());
  expect(await response.json()).toEqual({ success: true, signOutComplete: true });
  expect(response.cookies.get("sb-gntzjtuncsyefujajmjy-auth-token.0")?.maxAge).toBe(0);
  expect(response.cookies.get(BINDING)?.maxAge).toBe(0);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledTimes(1);
});
it("does not repeat a successful update or erase the session needed to retry sign-out", async () => {
  reset.mockResolvedValue({ signOutComplete: false });
  const response = await POST(request());
  expect(await response.json()).toEqual({ success: true, signOutComplete: false });
  // Only the used binding goes; the session cookies stay for the sign-out retry.
  expect(response.cookies.getAll().map((cookie) => cookie.name)).toEqual([BINDING]);
  expect(reset).toHaveBeenCalledTimes(1);
});
it("fails closed when the binding cannot be checked", async () => {
  vi.stubEnv("HMAC_SECRET", "");
  expect((await GET(check())).status).toBe(503);
  expect((await POST(request())).status).toBe(503);
  expect(reset).not.toHaveBeenCalled();
});
it.each([
  ["https://external.example", true],
  [APP, false],
])("rejects untrusted mutation proof %s", async (origin, proof) => {
  expect((await POST(request(payload, origin, proof))).status).toBe(403);
  expect(authenticate).not.toHaveBeenCalled();
});
it("remains disabled during preparation", async () => {
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "");
  expect((await POST(request())).status).toBe(503);
  expect(context).not.toHaveBeenCalled();
});
