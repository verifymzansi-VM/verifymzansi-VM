/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { isPwnedPassword } from "@/lib/security/pwned-passwords";

vi.mock("@/lib/security/pwned-passwords", () => ({
  isPwnedPassword: vi.fn(),
  PWNED_PASSWORD_ERROR: "Choose a password absent from known breaches",
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "registration-client" }),
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
  vi.mocked(isPwnedPassword).mockResolvedValue(false);
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
  expect(await response.json()).toEqual({ ok: true, message: expect.any(String) });
  expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith({
    key: "registration-client",
    action: "auth:register",
    degradedMode: "block",
  });
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
    data: { display_name: submission.displayName },
    code_challenge_method: "s256",
    gotrue_meta_security: { captcha_token: submission.turnstileToken },
  });
  expect(Object.keys(body.data)).toEqual(["display_name"]);
  expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(new Headers(options?.headers).get("apikey")).toBe(publicKey);
  expect(options).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
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
    expect(await response.json()).toEqual({ ok: true, message: expect.any(String) });
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
