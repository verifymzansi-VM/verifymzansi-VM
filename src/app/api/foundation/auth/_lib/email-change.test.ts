/** @vitest-environment node */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/account/email/change/route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { FoundationAccountContextError } from "@/lib/foundation/account-context";
import {
  createFoundationEmailChanger,
  FoundationEmailChangeError,
} from "@/lib/foundation/email-change";

const { authenticate, context, respond, readAccount, limit, legacy, logged, hold } = vi.hoisted(
  () => ({
    hold: vi.fn(),
    authenticate: vi.fn(),
    context: vi.fn(),
    respond: vi.fn(),
    readAccount: vi.fn(),
    limit: vi.fn(),
    legacy: vi.fn(),
    logged: vi.fn(),
  })
);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: legacy, createPublicClient: legacy }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: legacy }));
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
vi.mock("@/lib/foundation/answer-floor", () => ({ holdAnswer: hold }));
vi.mock("@/lib/utils/logger", () => {
  const logger = {
    debug: (...args: unknown[]) => logged("debug", ...args),
    info: (...args: unknown[]) => logged("info", ...args),
    warn: (...args: unknown[]) => logged("warn", ...args),
    error: (...args: unknown[]) => logged("error", ...args),
  };
  return { createLogger: () => logger };
});

const host = "gntzjtuncsyefujajmjy";
const connection = {
  url: `https://${host}.supabase.co`,
  expectedProjectRef: host,
  publishableKey: "sb_publishable_synthetic",
};
const id = "00000000-0000-4000-8000-000000000001";
const csrf = "e".repeat(64);
const now = () => Math.floor(Date.now() / 1000);
const CURRENT = "member@example.invalid";
const NEXT = "next@example.invalid";
const ACCEPTED = {
  success: true,
  message:
    "If the new address can be used, a confirmation link is on its way to it and to your current address. The change completes once both links are opened.",
};
const SIGN_IN_AGAIN = {
  error: "For your security, sign out and sign in again before changing your email address.",
  code: "reauthentication_required",
};
const MFA_REQUIRED = {
  error: "Confirm your authenticator code before changing your email address",
  code: "mfa_required",
};
const TOO_MANY = { error: "Too many email change requests; try again later", code: "rate_limited" };
const UNAVAILABLE = { error: "Email change is temporarily unavailable" };
const INVALID = { error: "Enter a valid email address", code: "invalid_email" };
const ANSWER_TIME = { floorMs: 3000, jitterMs: 1000 };
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** Limiter keys: digests, never the address itself (limiter-key.ts). */
const PAIR_KEY = "account-email:" + sha256(`account-email\n${id}\n${NEXT}`);
const ADDRESS_KEY = "email:" + sha256(`email\n${NEXT}`);

const memberUser = () => ({
  id,
  email: CURRENT,
  email_confirmed_at: "2026-11-01T00:00:00Z",
  identities: [{ provider: "email" }],
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
});
const changeEmail = vi.fn();
const caller = (overrides: Record<string, unknown> = {}) => ({
  accountId: id,
  sessionId: "00000000-0000-4000-8000-000000000101",
  api: {},
  user: memberUser(),
  recovery: null,
  openedByRecovery: false,
  signedInAt: now() - 60,
  signedInWithPassword: true,
  authenticatorAt: null,
  changeEmail,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries({
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_SUPABASE_URL: connection.url,
    FOUNDATION_PROJECT_REF: host,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: connection.publishableKey,
    // Never needed: the change uses the member's own session.
    FOUNDATION_SUPABASE_SECRET_KEY: "",
    NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  }))
    vi.stubEnv(name, value);
  respond.mockImplementation(async (response: Response) => response);
  context.mockReturnValue({ authenticateCaller: authenticate, respond });
  authenticate.mockResolvedValue(caller());
  readAccount.mockResolvedValue({ account_id: id, staff: null, totp_enrolled: false });
  limit.mockResolvedValue({ limited: false });
  changeEmail.mockResolvedValue("requested");
  hold.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function request(
  body: unknown = { newEmail: NEXT },
  origin = "https://verifymzansi.com",
  proof = true
) {
  return new NextRequest("https://verifymzansi.com/api/account/email/change", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(proof ? { cookie: "vm_csrf=" + csrf, "x-csrf-token": csrf } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function expectNothingAsked() {
  expect(changeEmail).not.toHaveBeenCalled();
  expect(hold).not.toHaveBeenCalled();
}

/** Budgets charged so far, by action. */
const charged = () => limit.mock.calls.map(([options]) => options.action);

describe("email change on the foundation backend", () => {
  it("asks Auth for both confirmations with the member's session, after every check", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ACCEPTED);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(changeEmail).toHaveBeenCalledTimes(1);
    const [email, redirectTo] = changeEmail.mock.calls[0];
    expect(email).toBe(NEXT);
    const landing = new URL(redirectTo);
    expect(landing.origin).toBe("https://verifymzansi.com");
    expect(landing.pathname).toBe("/auth/callback");
    expect(landing.searchParams.get("backend")).toBe("foundation");
    expect(landing.searchParams.get("email_change")).toBe("1");
    expect(landing.searchParams.has("recovery")).toBe(false);
    // Budgets in order (network, account, account and new address, new
    // address, platform), all before Auth is asked and all failing closed.
    expect(limit.mock.calls.map(([options]) => options)).toEqual([
      { key: "synthetic-ip", action: "account:email-change", degradedMode: "block" },
      { key: "account:" + id, action: "account:email-change:account", degradedMode: "block" },
      { key: PAIR_KEY, action: "account:email-change:recipient", degradedMode: "block" },
      { key: ADDRESS_KEY, action: "account:email-change:address", degradedMode: "block" },
      { key: "global", action: "account:email-change:global", degradedMode: "block" },
    ]);
    expect(JSON.stringify(limit.mock.calls)).not.toContain(NEXT);
    expect(changeEmail.mock.invocationCallOrder[0]).toBeGreaterThan(
      limit.mock.invocationCallOrder[4]
    );
    // The answer waits for its minimum time, counted from the Auth request.
    expect(hold).toHaveBeenCalledTimes(1);
    expect(hold.mock.calls[0][1]).toEqual(ANSWER_TIME);
    expect(hold.mock.invocationCallOrder[0]).toBeGreaterThan(
      changeEmail.mock.invocationCallOrder[0]
    );
    expect(respond.mock.invocationCallOrder[0]).toBeGreaterThan(hold.mock.invocationCallOrder[0]);
    expect(readAccount).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
    // The retired backend's clients are never created.
    expect(legacy).not.toHaveBeenCalled();
  });

  it("normalises the new address before every check", async () => {
    expect((await POST(request({ newEmail: "  Next@Example.INVALID " }))).status).toBe(200);
    expect(changeEmail.mock.calls[0][0]).toBe(NEXT);
    expect(limit.mock.calls[2][0].key).toBe(PAIR_KEY);
    expect(limit.mock.calls[3][0].key).toBe(ADDRESS_KEY);
  });

  it("gives an address of another account, or Auth's email limit, exactly the accepted answer", async () => {
    // Real Auth replies through the real command: accepted, address taken,
    // and Auth's own email limits (which it checks after the address).
    const answer = async (reply: Response) => {
      const fetcher = vi.fn<typeof fetch>(async () => reply);
      authenticate.mockResolvedValue(
        caller({ changeEmail: createFoundationEmailChanger(connection, "synthetic", id, fetcher) })
      );
      const response = await POST(request());
      expect(fetcher).toHaveBeenCalledTimes(1);
      return {
        status: response.status,
        body: await response.text(),
        headers: [...response.headers].filter(([name]) => name !== "date"),
        cookies: response.cookies.getAll(),
      };
    };
    const accepted = await answer(Response.json({ id, email: CURRENT, new_email: NEXT }));
    // Auth's reply to API version 2024-01-01, as seen from local Auth.
    const taken = await answer(
      Response.json({ code: "email_exists", message: "PRIVATE_PROVIDER_DETAIL" }, { status: 422 })
    );
    const limited = await answer(
      Response.json(
        { code: "over_email_send_rate_limit", message: "PRIVATE_PROVIDER_DETAIL" },
        { status: 429 }
      )
    );
    const projectLimited = await answer(new Response(null, { status: 429 }));
    expect(taken).toEqual(accepted);
    expect(limited).toEqual(accepted);
    expect(projectLimited).toEqual(accepted);
    expect(accepted.status).toBe(200);
    // Each waited for the same minimum time.
    expect(hold.mock.calls.map(([, time]) => time)).toEqual([
      ANSWER_TIME,
      ANSWER_TIME,
      ANSWER_TIME,
      ANSWER_TIME,
    ]);
    expect(logged).toHaveBeenCalledWith("warn", "Email change held back by Auth's email limits");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  });

  it("refuses, and logs without details, an address Auth changed without confirmation", async () => {
    changeEmail.mockResolvedValue("applied");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(UNAVAILABLE);
    expect(logged).toHaveBeenCalledWith(
      "error",
      "Email change applied without confirmation; check Auth email settings"
    );
    expect(hold).not.toHaveBeenCalled();
  });

  it("logs, without details, an Auth step slower than the answer time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      changeEmail.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + ANSWER_TIME.floorMs + 1);
        return "requested";
      });
      expect((await POST(request())).status).toBe(200);
      expect(logged).toHaveBeenCalledWith("warn", "Email change took longer than its answer time");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not log a slow step when Auth answered within the answer time", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(logged).not.toHaveBeenCalledWith(
      "warn",
      "Email change took longer than its answer time"
    );
  });

  it.each([
    ["FOUNDATION_PASSWORD_AUTH_MODE", ""],
    ["FOUNDATION_AUTH_CALLBACK_ENABLED", "false"],
  ])("stays closed while %s is %j", async (name, value) => {
    vi.stubEnv(name, value);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(UNAVAILABLE);
    expect(context).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
    expectNothingAsked();
  });

  it.each([
    ["https://external.example", true],
    ["https://verifymzansi.com", false],
  ])("refuses missing or cross-origin request proof %s", async (origin, proof) => {
    const response = await POST(request(undefined, origin, proof));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(context).not.toHaveBeenCalled();
    expectNothingAsked();
  });

  it.each([
    [
      { limited: true },
      429,
      { error: "Too many attempts; try again shortly", code: "rate_limited" },
    ],
    [{ limited: true, degraded: true }, 503, UNAVAILABLE],
    [{ limited: false, degraded: true }, 503, UNAVAILABLE],
  ])("applies the network limit before the session is read: %j", async (result, status, body) => {
    limit.mockResolvedValueOnce(result);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    if (status === 429) expect(response.headers.get("retry-after")).toBe("60");
    expect(authenticate).not.toHaveBeenCalled();
    expectNothingAsked();
  });

  it.each([
    [401, 401, { error: "Sign in again to change your email address" }],
    [503, 503, UNAVAILABLE],
  ] as const)("needs a verified session (%s)", async (failure, status, body) => {
    authenticate.mockRejectedValue(new FoundationSessionError(failure));
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(respond).toHaveBeenCalledTimes(1);
    expectNothingAsked();
  });

  it.each([
    ["a live recovery session", { recovery: { sessionId: id, issuedAt: 1 } }],
    ["a session opened by a reset link over an hour ago", { openedByRecovery: true }],
  ])("refuses %s, as the password commands do", async (_label, session) => {
    authenticate.mockResolvedValue(caller(session));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Finish resetting your password, then sign in again to change your email address",
      reason: "recovery_session",
    });
    expect(readAccount).not.toHaveBeenCalled();
    expect(charged()).toEqual(["account:email-change"]);
    expectNothingAsked();
  });

  it.each([
    ["an unconfirmed current address", { ...memberUser(), email_confirmed_at: null }],
    ["no current address", { ...memberUser(), email: undefined }],
    ["an unreadable current address", { ...memberUser(), email: "not-an-address" }],
  ])("refuses an account with %s", async (_label, user) => {
    authenticate.mockResolvedValue(caller({ user }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Confirm your current email address before changing it",
      code: "email_unconfirmed",
    });
    expectNothingAsked();
  });

  it.each([
    ["a malformed address", { newEmail: "not-an-address" }],
    ["an empty address", { newEmail: "" }],
    ["an over-long address", { newEmail: `${"a".repeat(250)}@example.invalid` }],
    ["a non-text address", { newEmail: ["next@example.invalid"] }],
    ["no address", {}],
    ["an extra field", { newEmail: NEXT, email: CURRENT }],
    ["a body that is not JSON", "{ not json"],
    ["an oversized body", { newEmail: NEXT, padding: "x".repeat(5000) }],
  ])("refuses %s before any budget or Auth request", async (_label, body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(INVALID);
    expect(charged()).toEqual(["account:email-change"]);
    expectNothingAsked();
  });

  it.each([CURRENT, " Member@EXAMPLE.invalid "])(
    "refuses the current address (%j) as the new one",
    async (newEmail) => {
      const response = await POST(request({ newEmail }));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: "This is already your current email address.",
        code: "same_email",
      });
      expectNothingAsked();
    }
  );

  it.each([
    ["over an hour ago", now() - 3601],
    ["never (no sign-in in the session)", null],
  ])("asks a member who signed in %s to sign in again", async (_label, signedInAt) => {
    authenticate.mockResolvedValue(caller({ signedInAt }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(SIGN_IN_AGAIN);
    expect(readAccount).not.toHaveBeenCalled();
    expect(charged()).toEqual(["account:email-change"]);
    expectNothingAsked();
  });

  it("accepts a sign-in just inside the hour", async () => {
    authenticate.mockResolvedValue(caller({ signedInAt: now() - 3590 }));
    expect((await POST(request())).status).toBe(200);
  });

  it.each([
    [
      "a suspended or closed account",
      new FoundationAccountContextError("forbidden"),
      403,
      { error: "Email change is not permitted for this account" },
    ],
    ["an unreadable account", new FoundationAccountContextError("unavailable"), 503, UNAVAILABLE],
  ])("refuses %s", async (_label, error, status, body) => {
    readAccount.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expectNothingAsked();
  });

  it("refuses another account's context", async () => {
    readAccount.mockResolvedValue({
      account_id: "00000000-0000-4000-8000-000000000002",
      staff: null,
    });
    expect((await POST(request())).status).toBe(503);
    expectNothingAsked();
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
    expect(await response.json()).toEqual(MFA_REQUIRED);
    expect(charged()).toEqual(["account:email-change"]);
    expectNothingAsked();
  });

  it("lets staff with a fresh authenticator step ask", async () => {
    readAccount.mockResolvedValue({
      account_id: id,
      staff: { can_access: true },
      totp_enrolled: true,
    });
    authenticate.mockResolvedValue(caller({ authenticatorAt: now() - 600 }));
    expect((await POST(request())).status).toBe(200);
  });

  it("asks a member with an authenticator to use it before any budget is spent", async () => {
    // Auth would refuse a one-step session of such a member anyway.
    readAccount.mockResolvedValue({ account_id: id, staff: null, totp_enrolled: true });
    authenticate.mockResolvedValue(caller({ authenticatorAt: null }));
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(MFA_REQUIRED);
    expect(charged()).toEqual(["account:email-change"]);
    expectNothingAsked();
  });

  it("lets a member with an authenticator ask from a two-step session", async () => {
    // Members (not staff) need the two-step session, not a recent step.
    readAccount.mockResolvedValue({ account_id: id, staff: null, totp_enrolled: true });
    authenticate.mockResolvedValue(caller({ authenticatorAt: now() - 7200 }));
    expect((await POST(request())).status).toBe(200);
  });

  it.each([
    ["the account's", "account:email-change:account", { limited: true }, 429],
    ["the account's", "account:email-change:account", { limited: true, degraded: true }, 503],
    ["the account and address", "account:email-change:recipient", { limited: true }, 429],
    [
      "the account and address",
      "account:email-change:recipient",
      { limited: false, degraded: true },
      503,
    ],
    ["the new address's daily", "account:email-change:address", { limited: true }, 429],
    [
      "the new address's daily",
      "account:email-change:address",
      { limited: false, degraded: true },
      503,
    ],
    ["the platform's", "account:email-change:global", { limited: true }, 429],
    ["the platform's", "account:email-change:global", { limited: false, degraded: true }, 503],
  ])("refuses at %s budget (%s): %j", async (_label, action, result, status) => {
    limit.mockImplementation(async (options: { action: string }) =>
      options.action === action ? result : { limited: false }
    );
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(status === 429 ? TOO_MANY : UNAVAILABLE);
    if (status === 429) expect(response.headers.get("retry-after")).toBe("60");
    expectNothingAsked();
  });

  it.each([
    [new FoundationEmailChangeError(403, "mfa_required"), 403, MFA_REQUIRED],
    [
      new FoundationEmailChangeError(401, "session"),
      401,
      { error: "Sign in again to change your email address" },
    ],
    [new FoundationEmailChangeError(400, "invalid_email"), 400, INVALID],
    [
      new FoundationEmailChangeError(503, "unavailable"),
      503,
      { error: "Your email change could not be confirmed. Try again shortly." },
    ],
    [new Error("synthetic"), 503, UNAVAILABLE],
  ])("maps Auth's refusal %o", async (error, status, body) => {
    changeEmail.mockRejectedValue(error);
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(hold).not.toHaveBeenCalled();
  });

  it("never logs an address, the request body or a token", async () => {
    for (const setup of [
      () => changeEmail.mockResolvedValue("applied"),
      () => changeEmail.mockResolvedValue("limited"),
      () => changeEmail.mockRejectedValue(new FoundationEmailChangeError(503, "unavailable")),
      () => changeEmail.mockRejectedValue(new Error(`synthetic ${NEXT}`)),
      () => readAccount.mockRejectedValue(new FoundationAccountContextError("unavailable")),
    ]) {
      setup();
      await POST(request());
    }
    expect(logged).toHaveBeenCalled();
    const text = JSON.stringify(logged.mock.calls);
    for (const secret of [NEXT, CURRENT, "next@", csrf, "synthetic.verified"])
      expect(text).not.toContain(secret);
  });
});
