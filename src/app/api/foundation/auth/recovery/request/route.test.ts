/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "recovery-ip" }),
}));
const host = "gntzjtuncsyefujajmjy";
const fetcher = vi.fn<typeof fetch>();
const csrf = "f".repeat(64);
beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries({
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_RECOVERY_ENABLED: "true",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_SUPABASE_URL: `https://${host}.supabase.co`,
    FOUNDATION_PROJECT_REF: host,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  }))
    vi.stubEnv(name, value);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  fetcher.mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function request(
  body: unknown = { email: "MEMBER@example.invalid", turnstileToken: "synthetic-captcha" },
  origin = "https://verifymzansi.com",
  proof = true
) {
  return new NextRequest("https://verifymzansi.com/api/foundation/auth/recovery/request", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(proof ? { cookie: "vm_csrf=" + csrf, "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify(body),
  });
}
it("requests native CAPTCHA verification exactly once with a selected PKCE flow and generic reply", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  const target = new URL(String(url));
  expect(target.origin).toBe(`https://${host}.supabase.co`);
  expect(target.pathname).toBe("/auth/v1/recover");
  const callback = new URL(target.searchParams.get("redirect_to")!);
  expect(callback.pathname).toBe("/auth/callback");
  expect(callback.searchParams.get("backend")).toBe("foundation");
  expect(callback.searchParams.get("recovery")).toBe("1");
  expect(callback.searchParams.get("sb_flow_id")).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  expect(JSON.parse(String(init?.body))).toMatchObject({
    email: "member@example.invalid",
    gotrue_meta_security: { captcha_token: "synthetic-captcha" },
    code_challenge_method: "s256",
  });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(JSON.stringify(await response.json())).not.toContain("member@example.invalid");
  expect(
    response.cookies
      .getAll()
      .some((cookie) => cookie.name.endsWith("-code-verifier") && cookie.value)
  ).toBe(true);
  expect(response.cookies.getAll().some((cookie) => cookie.name === `sb-${host}-auth-token`)).toBe(
    false
  );
});
it("does not open recovery while the feature is closed", async () => {
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "");
  expect((await POST(request())).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  ["https://external.example", true],
  ["https://verifymzansi.com", false],
])("refuses missing or cross-origin request proof %s", async (origin, proof) => {
  expect((await POST(request(undefined, origin, proof))).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(["dev-turnstile-bypass", "turnstile-unavailable", ""])(
  "does not send a placeholder CAPTCHA %s",
  async (token) => {
    expect(
      (await POST(request({ email: "member@example.invalid", turnstileToken: token }))).status
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it("fails closed when shared protection is degraded", async () => {
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, degraded: true });
  expect((await POST(request())).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});
it("uses a generic success for a recipient limit without sending another message", async () => {
  vi.mocked(checkRateLimit)
    .mockResolvedValueOnce({ limited: false })
    .mockResolvedValueOnce({ limited: true });
  expect((await POST(request())).status).toBe(200);
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not expose an address-specific provider refusal or discard its random verifier state", async () => {
  fetcher.mockResolvedValue(
    Response.json(
      { error_code: "email_not_confirmed", msg: "PRIVATE_PROVIDER_DETAIL" },
      { status: 400 }
    )
  );
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_PROVIDER_DETAIL");
  expect(
    response.cookies
      .getAll()
      .some(
        (cookie) => cookie.name.endsWith("-code-verifier") && cookie.value && cookie.maxAge !== 0
      )
  ).toBe(true);
});
