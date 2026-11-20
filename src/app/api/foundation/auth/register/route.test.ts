/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import { isPwnedPassword } from "@/lib/security/pwned-passwords";
import { readFoundationSignupMode } from "@/lib/foundation/signup-mode";

vi.mock("@/lib/security/pwned-passwords", () => ({
  isPwnedPassword: vi.fn(),
  PWNED_PASSWORD_ERROR: "Choose a password absent from known breaches",
}));
// The database's sign-up mode (api.get_signup_mode); null: not readable, so
// FOUNDATION_REGISTRATION_INVITE_ONLY decides.
vi.mock("@/lib/foundation/signup-mode", () => ({ readFoundationSignupMode: vi.fn() }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: vi.fn(() => ({ key: "registration-client" })),
}));

const project = "gntzjtuncsyefujajmjy";
const publicKey = "sb_publishable_synthetic";
const csrf = "b".repeat(64);
const submission = {
  displayName: "Thando M.",
  email: "new@example.invalid",
  password: "synthetic-long-password",
  confirmPassword: "synthetic-long-password",
  acceptTerms: true,
  turnstileToken: "synthetic-registration-captcha",
};
const fetcher = vi.fn<typeof fetch>();
function registerRequest(body: unknown = submission, { safe = true, csrfValid = true } = {}) {
  return new NextRequest("https://verifymzansi.com/api/foundation/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: safe ? "https://verifymzansi.com" : "https://other.example",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(csrfValid ? { "x-csrf-token": csrf } : {}),
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_REGISTRATION_ENABLED: "true",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_SUPABASE_URL: `https://${project}.supabase.co`,
    FOUNDATION_PROJECT_REF: project,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: publicKey,
    NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  }))
    vi.stubEnv(key, value);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(getClientRateLimitIdentity).mockReturnValue({
    key: "registration-client",
    source: "unknown",
  });
  vi.mocked(isPwnedPassword).mockResolvedValue(false);
  vi.mocked(readFoundationSignupMode).mockResolvedValue(null);
  fetcher.mockImplementation(async () =>
    Response.json({
      id: "00000000-0000-4000-8000-000000000008",
      email: submission.email,
      aud: "authenticated",
      email_confirmed_at: null,
      identities: [],
    })
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses native CAPTCHA and PKCE in one signup call, without a legacy profile write or auto-login", async () => {
  const response = await POST(registerRequest({ ...submission, email: " NEW@Example.invalid " }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    inviteOnly: false,
    message: expect.any(String),
  });
  // Checked before Auth is asked, then spent once Auth has handled it.
  expect(vi.mocked(checkRateLimit).mock.calls.map(([options]) => options)).toEqual([
    { key: "registration-client", action: "auth:register", degradedMode: "block", readOnly: true },
    { key: "registration-client", action: "auth:register", degradedMode: "block" },
  ]);
  expect(isPwnedPassword).toHaveBeenCalledExactlyOnceWith(submission.password);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0];
  const target = new URL(String(url));
  expect(target.origin + target.pathname).toBe(`https://${project}.supabase.co/auth/v1/signup`);
  const callback = new URL(target.searchParams.get("redirect_to")!);
  expect(callback.origin + callback.pathname).toBe("https://verifymzansi.com/auth/callback");
  expect(callback.searchParams.get("next")).toBe("/dashboard/complete-profile");
  expect(callback.searchParams.get("backend")).toBe("foundation");
  const body = JSON.parse(String(options?.body));
  expect(body).toMatchObject({
    email: submission.email,
    password: submission.password,
    data: { display_name: submission.displayName, terms_accepted: true },
    code_challenge_method: "s256",
    gotrue_meta_security: { captcha_token: submission.turnstileToken },
  });
  expect(Object.keys(body.data)).toEqual(["display_name", "terms_accepted"]);
  expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(new Headers(options?.headers).get("apikey")).toBe(publicKey);
  expect(options).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "manual" });
  const cookies = response.cookies.getAll();
  expect(cookies.length).toBeGreaterThan(0);
  expect(
    cookies.every(
      (cookie) =>
        cookie.name.startsWith(`sb-${project}-auth-token-`) &&
        cookie.name.endsWith("-code-verifier") &&
        cookie.secure
    )
  ).toBe(true);
  expect(cookies.some((cookie) => cookie.name === `sb-${project}-auth-token-code-verifier`)).toBe(
    true
  );
  expect(response.cookies.get(`sb-${project}-auth-token`)).toBeUndefined();
  expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
});
it.each(["", "false"])("keeps registration closed for mode %s", async (value) => {
  vi.stubEnv("FOUNDATION_REGISTRATION_ENABLED", value);
  const response = await POST(registerRequest());
  expect(response.status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
  expect(isPwnedPassword).not.toHaveBeenCalled();
});
it.each([{ safe: false }, { csrfValid: false }])(
  "rejects unsafe registration before breach or provider checks %#",
  async (options) => {
    const response = await POST(registerRequest(submission, options));
    expect(response.status).toBe(403);
    expect(isPwnedPassword).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it.each([
  { displayName: "Admin" },
  { displayName: "VerifyMzansi" },
  { displayName: "A" },
  { acceptTerms: false },
  { password: "short", confirmPassword: "short" },
  { confirmPassword: "different" },
  { turnstileToken: "turnstile-unavailable" },
  { turnstileToken: "dev-turnstile-bypass" },
  { role: "admin" },
  { user_metadata: { admin: true } },
  { displayName: "x".repeat(4096) },
])("refuses invalid or authority-bearing registration fields %#", async (change) => {
  const response = await POST(registerRequest({ ...submission, ...change }));
  expect(response.status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  expect(isPwnedPassword).not.toHaveBeenCalled();
});
it.each([true, "unavailable"])(
  "fails closed for breached or unavailable password checks: %s",
  async (result) => {
    if (result === true) vi.mocked(isPwnedPassword).mockResolvedValue(true);
    else vi.mocked(isPwnedPassword).mockRejectedValue(new Error("private diagnostic"));
    const response = await POST(registerRequest());
    expect(response.status).toBe(result === true ? 400 : 503);
    expect(await response.text()).not.toContain("private diagnostic");
    expect(fetcher).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  }
);
it.each(["user_already_exists", "email_exists"])(
  "does not disclose an already registered email: %s",
  async (code) => {
    fetcher.mockImplementation(async () =>
      Response.json(
        { code, msg: "PRIVATE_EXISTING_EMAIL" },
        { status: 422, headers: { "x-supabase-api-version": "2024-01-01" } }
      )
    );
    const response = await POST(registerRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      inviteOnly: false,
      message: expect.any(String),
    });
    expect(response.cookies.getAll().length).toBeGreaterThan(0);
    expect(
      response.cookies.getAll().every((cookie) => cookie.value && (cookie.maxAge ?? 0) > 0)
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
);
it.each([
  ["captcha_failed", 400, 400],
  ["signup_disabled", 403, 503],
  ["over_email_send_rate_limit", 429, 429],
  ["unexpected_failure", 500, 503],
])("sanitizes signup provider refusal %s", async (code, status, expected) => {
  fetcher.mockImplementation(async () =>
    Response.json(
      { code, msg: "PRIVATE_PROVIDER_DIAGNOSTIC" },
      { status: Number(status), headers: { "x-supabase-api-version": "2024-01-01" } }
    )
  );
  const response = await POST(registerRequest());
  expect(response.status).toBe(Number(expected));
  expect(await response.text()).not.toContain("PRIVATE_PROVIDER_DIAGNOSTIC");
  expect(response.cookies.getAll()).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("discards cookies if provider confirmation settings unexpectedly issue a session", async () => {
  fetcher.mockImplementation(async () =>
    Response.json({
      access_token: "synthetic",
      refresh_token: "synthetic",
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "00000000-0000-4000-8000-000000000008" },
    })
  );
  const response = await POST(registerRequest());
  expect(response.status).toBe(503);
  expect(response.cookies.getAll()).toEqual([]);
});
it("answers a sign-up the invitation guard refuses exactly like any other address", async () => {
  vi.stubEnv("FOUNDATION_REGISTRATION_INVITE_ONLY", "true");
  fetcher.mockImplementation(async () =>
    Response.json(
      { code: "unexpected_failure", msg: "Registration is not open yet" },
      { status: 403, headers: { "x-supabase-api-version": "2024-01-01" } }
    )
  );
  const refused = await POST(registerRequest());
  expect(refused.status).toBe(200);
  const refusedBody = await refused.json();
  expect(JSON.stringify(refusedBody)).not.toContain("not open yet");

  fetcher.mockImplementation(async () =>
    Response.json({
      id: "00000000-0000-4000-8000-000000000008",
      email: submission.email,
      aud: "authenticated",
      email_confirmed_at: null,
      identities: [],
    })
  );
  const accepted = await POST(registerRequest());
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual(refusedBody);
  expect(refusedBody).toEqual({
    ok: true,
    inviteOnly: true,
    message: expect.stringContaining("open by invitation for now"),
  });
});
it("words the uniform reply from the database's sign-up mode before the environment switch", async () => {
  vi.stubEnv("FOUNDATION_REGISTRATION_INVITE_ONLY", "false");
  vi.mocked(readFoundationSignupMode).mockResolvedValue("invite_only");
  const closed = await POST(registerRequest());
  expect(await closed.json()).toEqual({
    ok: true,
    inviteOnly: true,
    message: expect.stringContaining("open by invitation for now"),
  });
  expect(readFoundationSignupMode).toHaveBeenCalledWith(
    expect.objectContaining({ publishableKey: publicKey })
  );

  vi.stubEnv("FOUNDATION_REGISTRATION_INVITE_ONLY", "true");
  vi.mocked(readFoundationSignupMode).mockResolvedValue("open");
  const open = await POST(registerRequest());
  expect(await open.json()).toEqual({
    ok: true,
    inviteOnly: false,
    message: "If registration is available for this email, check your inbox to continue.",
  });
});
it("never reads the sign-up mode for a refused request", async () => {
  const response = await POST(registerRequest({ ...submission, acceptTerms: false }));
  expect(response.status).toBe(400);
  expect(readFoundationSignupMode).not.toHaveBeenCalled();
});
it("refuses a sign-up without a CAPTCHA token before it counts against any limit", async () => {
  for (const turnstileToken of [undefined, "", "   ", 7]) {
    const response = await POST(registerRequest({ ...submission, turnstileToken }));
    expect(response.status).toBe(400);
  }
  const junk = new NextRequest("https://verifymzansi.com/api/foundation/auth/register", {
    method: "POST",
    body: "not json",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
  });
  expect((await POST(junk)).status).toBe(400);
  expect(checkRateLimit).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
it("counts an IPv6 sign-up per /64 and, more loosely, per /48", async () => {
  vi.mocked(getClientRateLimitIdentity).mockReturnValue({
    key: "2001:db8:1:2::9",
    source: "cf-connecting-ip",
    ip: "2001:db8:1:2::9",
  });
  expect((await POST(registerRequest())).status).toBe(200);
  const address = { key: "v6:2001:db8:1:2::/64", action: "auth:register", degradedMode: "block" };
  const network = {
    key: "v6:2001:db8:1::/48",
    action: "auth:register:network",
    degradedMode: "block",
  };
  expect(vi.mocked(checkRateLimit).mock.calls.map(([options]) => options)).toEqual([
    { ...address, readOnly: true },
    { ...network, readOnly: true },
    address,
    network,
  ]);
  // The looser network bucket refuses too, before Auth is asked.
  vi.mocked(checkRateLimit).mockClear();
  fetcher.mockClear();
  vi.mocked(checkRateLimit)
    .mockResolvedValueOnce({ limited: false })
    .mockResolvedValueOnce({ limited: true, retryAfter: 120 });
  const limited = await POST(registerRequest());
  expect(limited.status).toBe(429);
  expect(limited.headers.get("Retry-After")).toBe("120");
  expect(fetcher).not.toHaveBeenCalled();
  expect(vi.mocked(checkRateLimit).mock.calls.every(([options]) => options.readOnly)).toBe(true);
});
it("never spends a limit on a made-up CAPTCHA token Auth refuses", async () => {
  fetcher.mockImplementation(async () =>
    Response.json(
      { code: "captcha_failed", msg: "captcha protection: request disallowed" },
      { status: 400, headers: { "x-supabase-api-version": "2024-01-01" } }
    )
  );
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await POST(registerRequest({ ...submission, turnstileToken: "x" }));
    expect(response.status).toBe(400);
  }
  expect(fetcher).toHaveBeenCalledTimes(12);
  // Only checks: nothing was spent.
  expect(vi.mocked(checkRateLimit).mock.calls.every(([options]) => options.readOnly)).toBe(true);
});
it("spends a limit on a real attempt Auth refuses for another reason", async () => {
  fetcher.mockImplementation(async () =>
    Response.json(
      { code: "weak_password", msg: "weak" },
      { status: 422, headers: { "x-supabase-api-version": "2024-01-01" } }
    )
  );
  expect((await POST(registerRequest())).status).toBe(400);
  expect(
    vi.mocked(checkRateLimit).mock.calls.map(([options]) => options.readOnly ?? false)
  ).toEqual([true, false]);
});
it("fails closed when the limiter cannot be checked, without asking Auth", async () => {
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, degraded: true });
  expect((await POST(registerRequest())).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});
describe("which Auth answers spend a sign-up limit", () => {
  const spent = () =>
    vi.mocked(checkRateLimit).mock.calls.map(([options]) => options.readOnly ?? false);
  const authAnswers = (body: unknown, status: number) =>
    fetcher.mockImplementation(async () =>
      Response.json(body, { status, headers: { "x-supabase-api-version": "2024-01-01" } })
    );

  it("spends one on a created account", async () => {
    expect((await POST(registerRequest())).status).toBe(200);
    expect(spent()).toEqual([true, false]);
  });

  it("spends one on an existing address, answered like a new one", async () => {
    authAnswers({ code: "user_already_exists", msg: "User already registered" }, 422);
    const response = await POST(registerRequest());
    expect(response.status).toBe(200);
    expect(spent()).toEqual([true, false]);
  });

  it("never spends one on Auth's own rate limit", async () => {
    authAnswers({ code: "over_request_rate_limit", msg: "Too many requests" }, 429);
    expect((await POST(registerRequest())).status).toBe(429);
    expect(spent()).toEqual([true]);
  });

  it("never spends one on an Auth failure, a timeout or a network failure", async () => {
    authAnswers({ code: "unexpected_failure", msg: "Internal" }, 500);
    expect((await POST(registerRequest())).status).toBe(503);
    fetcher.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await POST(registerRequest())).status).toBe(503);
    fetcher.mockImplementation(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect((await POST(registerRequest())).status).toBe(503);
    expect(spent()).toEqual([true, true, true]);
  });
});
