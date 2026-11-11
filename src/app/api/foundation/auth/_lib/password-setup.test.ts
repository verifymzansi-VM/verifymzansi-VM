/** @vitest-environment node */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/foundation/auth/recovery/request/route";
import { POST as compatibilityPOST } from "@/app/api/auth/forgot-password/route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { FoundationAccountContextError } from "@/lib/foundation/account-context";
import { isFoundationPasswordSetupInput } from "@/lib/foundation/password-setup-input";

const { authenticate, context, readAccount, limit, legacy } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  context: vi.fn(),
  readAccount: vi.fn(),
  limit: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: legacy, createPublicClient: legacy }));
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

const host = "gntzjtuncsyefujajmjy";
const id = "00000000-0000-4000-8000-000000000001";
const secret = "sb_secret_synthetic_unit_only";
const csrf = "e".repeat(64);
const now = () => Math.floor(Date.now() / 1000);
const fetcher = vi.fn<typeof fetch>();
const SIGN_IN_AGAIN = {
  error: "For your security, sign out and sign in again before setting a password.",
  code: "reauthentication_required",
};
const PASSWORD_EXISTS = {
  error: "This account already has a password. Use Change password instead.",
  code: "password_exists",
};

const googleUser = () => ({
  id,
  email: "member@example.invalid",
  email_confirmed_at: "2026-11-01T00:00:00Z",
  identities: [{ provider: "google" }],
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: {},
});
const caller = (overrides: Record<string, unknown> = {}) => ({
  accountId: id,
  sessionId: "00000000-0000-4000-8000-000000000101",
  api: {},
  user: googleUser(),
  recovery: null,
  openedByRecovery: false,
  signedInAt: now() - 60,
  signedInWithPassword: false,
  authenticatorAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries({
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_RECOVERY_ENABLED: "true",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_SUPABASE_URL: `https://${host}.supabase.co`,
    FOUNDATION_PROJECT_REF: host,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    FOUNDATION_SUPABASE_SECRET_KEY: secret,
    NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  }))
    vi.stubEnv(name, value);
  context.mockReturnValue({
    authenticateCaller: authenticate,
    respond: async (response: Response) => response,
  });
  authenticate.mockResolvedValue(caller());
  readAccount.mockResolvedValue({ account_id: id, staff: null });
  limit.mockResolvedValue({ limited: false });
  fetcher.mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function request(
  body: unknown = { email: "member@example.invalid" },
  origin = "https://verifymzansi.com",
  proof = true
) {
  return new NextRequest("https://verifymzansi.com/api/auth/forgot-password", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(proof ? { cookie: "vm_csrf=" + csrf, "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Nothing reached Auth's email request. */
function expectNothingSent() {
  expect(fetcher).not.toHaveBeenCalled();
}

describe("which requests are password setup requests", () => {
  it.each([
    [{ email: "member@example.invalid" }, true],
    [{ email: "member@example.invalid", turnstileToken: "synthetic" }, false],
    [{ email: "member@example.invalid", turnstileToken: "" }, false],
    [{ email: "member@example.invalid", extra: true }, false],
    [{}, false],
    [["email"], false],
    [null, false],
    ["email", false],
  ])("%j: %s", (input, setup) => {
    expect(isFoundationPasswordSetupInput(input)).toBe(setup);
  });

  it("leaves forgot-password requests (with a token field) to the recovery path", async () => {
    // The anonymous path never asks for a signed-in caller.
    const response = await POST(request({ email: "member@example.invalid", turnstileToken: "" }));
    expect(response.status).toBe(400);
    expect(context).not.toHaveBeenCalled();
    expectNothingSent();
  });
});

describe("password setup for a member without a password", () => {
  it("emails the verified address a reset link with the server key and no CAPTCHA token", async () => {
    // The page's copy of the address may differ in case; the verified one is used.
    const response = await POST(request({ email: " Member@Example.invalid " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    const target = new URL(String(url));
    expect(target.origin).toBe(`https://${host}.supabase.co`);
    expect(target.pathname).toBe("/auth/v1/recover");
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe(secret);
    expect(headers.get("authorization")).toBe(`Bearer ${secret}`);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ email: "member@example.invalid", code_challenge_method: "s256" });
    expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // No CAPTCHA token (the SDK sends an empty security block).
    expect(body.gotrue_meta_security ?? {}).toEqual({});
    expect(JSON.stringify(body)).not.toContain("captcha");
    const callback = new URL(target.searchParams.get("redirect_to")!);
    expect(callback.origin).toBe("https://verifymzansi.com");
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("next")).toBe("/reset-password");
    expect(callback.searchParams.get("backend")).toBe("foundation");
    expect(callback.searchParams.get("recovery")).toBe("1");
    expect(callback.searchParams.get("sb_flow_id")).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    // The link's verifier is set; the member's own session cookies are untouched.
    const cookies = response.cookies.getAll();
    expect(cookies.some((cookie) => /-code-verifier/.test(cookie.name) && cookie.value)).toBe(true);
    expect(cookies.every((cookie) => /-code-verifier/.test(cookie.name))).toBe(true);
    // Budgets in order: the network, the account, the platform; the address's
    // forgot-password budget is only charged after the email was requested.
    expect(limit.mock.calls.map(([options]) => options)).toEqual([
      { key: "synthetic-ip", action: "auth:forgot-password", degradedMode: "block" },
      { key: "account:" + id, action: "auth:password-setup", degradedMode: "block" },
      { key: "global", action: "auth:password-setup:global", degradedMode: "block" },
      {
        // A digest of the address, never the address (limiter-key.ts).
        key: "email:" + createHash("sha256").update("email\nmember@example.invalid").digest("hex"),
        action: "auth:forgot-password-email",
        degradedMode: "block",
      },
    ]);
    expect(fetcher.mock.invocationCallOrder[0]).toBeLessThan(limit.mock.invocationCallOrder[3]);
    expect(readAccount).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
  });

  it("is not blocked by a used-up forgot-password budget for the address", async () => {
    // Others can spend that budget (with solved CAPTCHAs); it never refuses here.
    limit.mockImplementation(async (options: { action: string }) =>
      options.action === "auth:forgot-password-email" ? { limited: true } : { limited: false }
    );
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not charge the address budget when the email could not be requested", async () => {
    fetcher.mockResolvedValue(Response.json({ error_code: "unexpected_failure" }, { status: 500 }));
    expect((await POST(request())).status).toBe(503);
    expect(
      limit.mock.calls.some(([options]) => options.action === "auth:forgot-password-email")
    ).toBe(false);
  });

  it("publishes removals of verifier slots the SDK evicts, never session cookies", async () => {
    const session = `sb-${host}-auth-token`;
    const flows = ["a", "b", "c", "d", "e"].map((c) => c.repeat(32));
    const index = "base64-" + Buffer.from(JSON.stringify(flows)).toString("base64url");
    const slot = (flow: string) => `${session}-flow-${flow}-code-verifier`;
    const full = new NextRequest("https://verifymzansi.com/api/auth/forgot-password", {
      method: "POST",
      headers: {
        origin: "https://verifymzansi.com",
        "content-type": "application/json",
        cookie: [
          `vm_csrf=${csrf}`,
          `${session}=base64-synthetic-session`,
          `${session}-flows-code-verifier=${index}`,
          ...flows.map((flow) => `${slot(flow)}=base64-synthetic-verifier`),
        ].join("; "),
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ email: "member@example.invalid" }),
    });
    const response = await POST(full);
    expect(response.status).toBe(200);
    const written = response.cookies.getAll();
    // The oldest pending slot is removed in the browser too.
    expect(written.find((cookie) => cookie.name === slot(flows[0]))).toMatchObject({
      value: "",
      maxAge: 0,
    });
    // The new slot, the index and the fixed verifier are set.
    expect(
      written.filter((cookie) => cookie.value && /-code-verifier$/.test(cookie.name)).length
    ).toBeGreaterThanOrEqual(3);
    expect(
      written.filter((cookie) => cookie.name === session || cookie.name.startsWith(`${session}.`))
    ).toEqual([]);
  });

  it("leaves the member's session cookies alone", async () => {
    const session = `sb-${host}-auth-token`;
    const signedIn = new NextRequest("https://verifymzansi.com/api/auth/forgot-password", {
      method: "POST",
      headers: {
        origin: "https://verifymzansi.com",
        "content-type": "application/json",
        cookie: `vm_csrf=${csrf}; ${session}.0=base64-synthetic; ${session}.1=synthetic-rest`,
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ email: "member@example.invalid" }),
    });
    const response = await POST(signedIn);
    expect(response.status).toBe(200);
    expect(
      response.cookies.getAll().filter((cookie) => cookie.name.startsWith(`${session}.`))
    ).toEqual([]);
  });

  it("works the same through the page's forgot-password URL", async () => {
    const response = await compatibilityPOST(request());
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each([
    ["FOUNDATION_PASSWORD_AUTH_MODE", ""],
    ["FOUNDATION_RECOVERY_ENABLED", ""],
    ["FOUNDATION_AUTH_CALLBACK_ENABLED", "false"],
  ])("stays closed while %s is %j", async (name, value) => {
    vi.stubEnv(name, value);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Password setup is temporarily unavailable" });
    expect(context).not.toHaveBeenCalled();
    expectNothingSent();
  });

  it.each([
    ["https://external.example", true],
    ["https://verifymzansi.com", false],
  ])("refuses missing or cross-origin request proof %s", async (origin, proof) => {
    const response = await POST(request(undefined, origin, proof));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(context).not.toHaveBeenCalled();
    expectNothingSent();
  });

  it.each([
    [{ limited: true }, 429],
    [{ limited: true, degraded: true }, 503],
    [{ limited: false, degraded: true }, 503],
  ])("applies the network limit before the session is read: %j", async (result, status) => {
    limit.mockResolvedValueOnce(result);
    const response = await POST(request());
    expect(response.status).toBe(status);
    if (status === 429) expect(response.headers.get("retry-after")).toBe("60");
    expect(authenticate).not.toHaveBeenCalled();
    expectNothingSent();
  });

  it.each([
    [401, 401, { error: "Sign in again to set a password" }],
    [503, 503, { error: "Password setup is temporarily unavailable" }],
  ] as const)("needs a verified session (%s)", async (failure, status, body) => {
    authenticate.mockRejectedValue(new FoundationSessionError(failure));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expectNothingSent();
  });

  it.each([
    ["a live recovery session", { recovery: { sessionId: id, issuedAt: 1 } }],
    ["a session opened by a reset link over an hour ago", { openedByRecovery: true }],
  ])("refuses %s, as password change does", async (_label, session) => {
    authenticate.mockResolvedValue(caller(session));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Use the reset link from your email to set a new password",
      reason: "recovery_session",
    });
    expect(readAccount).not.toHaveBeenCalled();
    expectNothingSent();
  });

  it.each([
    ["another address", { email: "someone-else@example.invalid" }, googleUser()],
    ["a malformed address", { email: "not-an-address" }, googleUser()],
    [
      "an account without an address",
      { email: "member@example.invalid" },
      { ...googleUser(), email: undefined },
    ],
  ])("sends nothing when the page names %s", async (_label, body, user) => {
    authenticate.mockResolvedValue(caller({ user }));
    const response = await POST(request(body));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Your account details changed. Reload the page and try again.",
      code: "account_changed",
    });
    expectNothingSent();
  });

  it("needs a confirmed email address", async () => {
    authenticate.mockResolvedValue(caller({ user: { ...googleUser(), email_confirmed_at: null } }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("email_unconfirmed");
    expectNothingSent();
  });

  it.each([
    ["an email identity", { identities: [{ provider: "google" }, { provider: "email" }] }],
    [
      "only email sign-in",
      {
        identities: [{ provider: "email" }],
        app_metadata: { provider: "email", providers: ["email"] },
      },
    ],
    ["no readable identities", { identities: undefined }],
  ])(
    "refuses an account with %s (Change password asks for the current one)",
    async (_label, change) => {
      authenticate.mockResolvedValue(caller({ user: { ...googleUser(), ...change } }));
      const response = await POST(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual(PASSWORD_EXISTS);
      expect(readAccount).not.toHaveBeenCalled();
      expectNothingSent();
    }
  );

  it("does not take the account's sign-in methods from member-editable metadata", async () => {
    authenticate.mockResolvedValue(
      caller({
        user: {
          ...googleUser(),
          identities: [{ provider: "email" }],
          user_metadata: { provider: "google", providers: ["google"] },
        },
      })
    );
    expect((await POST(request())).status).toBe(409);
    expectNothingSent();
  });

  it("refuses a session signed in with a password, whatever the identities say", async () => {
    // GoTrue keeps only the Google identity when a Google member adds a
    // password (its email-identity option is off by default).
    authenticate.mockResolvedValue(caller({ signedInWithPassword: true }));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(PASSWORD_EXISTS);
    expectNothingSent();
  });

  it.each([
    ["over an hour ago", now() - 3601],
    ["never (no sign-in in the session)", null],
  ])("asks a member who signed in %s to sign in again", async (_label, signedInAt) => {
    authenticate.mockResolvedValue(caller({ signedInAt }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(SIGN_IN_AGAIN);
    expect(readAccount).not.toHaveBeenCalled();
    expectNothingSent();
  });

  it("accepts a sign-in just inside the hour", async () => {
    authenticate.mockResolvedValue(caller({ signedInAt: now() - 3590 }));
    expect((await POST(request())).status).toBe(200);
  });

  it.each([
    ["a suspended or closed account", new FoundationAccountContextError("forbidden"), 403],
    ["an unreadable account", new FoundationAccountContextError("unavailable"), 503],
  ])("refuses %s", async (_label, error, status) => {
    readAccount.mockRejectedValue(error);
    expect((await POST(request())).status).toBe(status);
    expectNothingSent();
  });

  it("refuses another account's context", async () => {
    readAccount.mockResolvedValue({
      account_id: "00000000-0000-4000-8000-000000000002",
      staff: null,
    });
    expect((await POST(request())).status).toBe(503);
    expectNothingSent();
  });

  it.each([
    ["staff whose session may not use staff tools", { can_access: false }, now() - 60],
    ["staff without an authenticator step in this session", { can_access: true }, null],
    ["staff whose authenticator step is over 15 minutes old", { can_access: true }, now() - 901],
  ])("asks %s to confirm the authenticator first", async (_label, staff, authenticatorAt) => {
    readAccount.mockResolvedValue({ account_id: id, staff });
    authenticate.mockResolvedValue(caller({ authenticatorAt }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("mfa_required");
    expect(limit.mock.calls.some(([options]) => options.action === "auth:password-setup")).toBe(
      false
    );
    expectNothingSent();
  });

  it("lets staff with a fresh authenticator step ask", async () => {
    readAccount.mockResolvedValue({ account_id: id, staff: { can_access: true } });
    authenticate.mockResolvedValue(caller({ authenticatorAt: now() - 600 }));
    expect((await POST(request())).status).toBe(200);
  });

  it.each([
    ["the account's", "auth:password-setup", { limited: true }, 429],
    ["the account's", "auth:password-setup", { limited: true, degraded: true }, 503],
    ["the platform's", "auth:password-setup:global", { limited: true }, 429],
    ["the platform's", "auth:password-setup:global", { limited: false, degraded: true }, 503],
  ])("refuses at %s budget (%s): %j", async (_label, action, result, status) => {
    limit.mockImplementation(async (options: { action: string }) =>
      options.action === action ? result : { limited: false }
    );
    const response = await POST(request());
    expect(response.status).toBe(status);
    if (status === 429) {
      expect(await response.json()).toEqual({
        error: "Too many password emails; try again later",
        code: "rate_limited",
      });
      expect(response.headers.get("retry-after")).toBe("60");
    }
    expectNothingSent();
  });

  it.each([
    ["missing", ""],
    ["not a secret key", "sb_publishable_synthetic"],
  ])("stays closed, before any budget, while the server key is %s", async (_label, value) => {
    vi.stubEnv("FOUNDATION_SUPABASE_SECRET_KEY", value);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Password setup is temporarily unavailable" });
    expect(context).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
    expectNothingSent();
  });

  it.each([
    [429, "over_email_send_rate_limit", 429],
    [400, "captcha_failed", 503],
    [500, "unexpected_failure", 503],
  ])("maps an Auth refusal %s %s without its detail", async (status, code, answer) => {
    fetcher.mockResolvedValue(
      Response.json({ error_code: code, msg: "PRIVATE_PROVIDER_DETAIL" }, { status })
    );
    const response = await POST(request());
    expect(response.status).toBe(answer);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_PROVIDER_DETAIL");
    // A failed request leaves no verifier behind.
    expect(response.cookies.getAll().filter((cookie) => cookie.value)).toEqual([]);
  });

  it("maps a network failure to unavailable", async () => {
    fetcher.mockRejectedValue(new TypeError("synthetic network failure"));
    expect((await POST(request())).status).toBe(503);
  });
});
