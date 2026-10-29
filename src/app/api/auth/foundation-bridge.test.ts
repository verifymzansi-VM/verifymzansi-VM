/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as register } from "./register/route";
import { POST as login } from "./login/route";
import { isPwnedPassword } from "@/lib/security/pwned-passwords";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw Error("Legacy database accessed");
  }),
}));
vi.mock("@/lib/security/pwned-passwords", () => ({
  isPwnedPassword: vi.fn(),
  PWNED_PASSWORD_ERROR: "breached",
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const csrf = "a".repeat(64);
const fetcher = vi.fn<typeof fetch>();
const body = {
  firstName: "Synthetic",
  lastName: "Member",
  phone: "0821234567",
  email: "synthetic@example.invalid",
  password: "synthetic-password-long",
  confirmPassword: "synthetic-password-long",
  acceptTerms: true,
  turnstileToken: "synthetic-challenge",
};
function request(path: string, value: unknown, validCsrf = true) {
  return new NextRequest(`https://verifymzansi.com/api/auth/${path}`, {
    method: "POST",
    body: JSON.stringify(value),
    headers: {
      "Content-Type": "application/json",
      Origin: "https://verifymzansi.com",
      Cookie: `vm_csrf=${csrf}`,
      ...(validCsrf ? { "x-csrf-token": csrf } : {}),
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_DATA_BACKEND: "foundation",
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_REGISTRATION_ENABLED: "true",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_SUPABASE_URL: "https://gntzjtuncsyefujajmjy.supabase.co",
    FOUNDATION_PROJECT_REF: "gntzjtuncsyefujajmjy",
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  }))
    vi.stubEnv(name, value);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(isPwnedPassword).mockResolvedValue(false);
  fetcher.mockResolvedValue(
    Response.json({
      id: "00000000-0000-4000-8000-000000000001",
      email: body.email,
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
it("maps the preserved registration form and forwards the CAPTCHA only to native Auth", async () => {
  const response = await register(request("register", body));
  expect(response.status).toBe(200);
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toContain("/auth/v1/signup");
  const sent = JSON.parse(String(init?.body));
  expect(sent.data).toMatchObject({
    display_name: "Synthetic Member",
    first_name: "Synthetic",
    last_name: "Member",
    phone: "+27821234567",
  });
  expect(sent.gotrue_meta_security.captcha_token).toBe(body.turnstileToken);
  expect(sent.data).not.toHaveProperty("phone_verified");
  expect(sent.data).not.toHaveProperty("role");
});
it("retains CSRF enforcement on the preserved registration URL", async () => {
  expect((await register(request("register", body, false))).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps native sign-in protection active on the preserved login URL", async () => {
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "");
  expect(
    (
      await login(
        request("login", {
          email: body.email,
          password: body.password,
          turnstileToken: body.turnstileToken,
        })
      )
    ).status
  ).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
  expect(createAdminClient).not.toHaveBeenCalled();
});
