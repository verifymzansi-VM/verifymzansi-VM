/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { signInFoundationPassword } from "@/lib/foundation/password-auth";

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "synthetic-ip" }),
}));

const ref = "gntzjtuncsyefujajmjy";
const config = {
  url: `https://${ref}.supabase.co`,
  expectedProjectRef: ref,
  publishableKey: "sb_publishable_synthetic",
};
const csrf = "a".repeat(64);
const credentials = {
  email: "person@example.invalid",
  password: "synthetic-password",
  turnstileToken: "synthetic-single-use-captcha",
};
function request(
  body: unknown = credentials,
  { origin = "https://verifymzansi.com", validCsrf = true, extraCookies = "" } = {}
) {
  return new NextRequest("https://verifymzansi.com/api/foundation/auth/login", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin,
      cookie: `vm_csrf=${csrf}; sb-tnygdgormnofpgjknlhr-auth-token=old-source-cookie${extraCookies ? `; ${extraCookies}` : ""}`,
      ...(validCsrf ? { "x-csrf-token": csrf } : {}),
    },
  });
}
const id = "00000000-0000-4000-8000-000000000001";
const session = (
  email = credentials.email,
  accountId = id,
  expiresAt = Math.floor(Date.now() / 1000) + 3600
) => ({
  access_token: [
    Buffer.from('{"alg":"ES256"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: accountId,
        iss: `${config.url}/auth/v1`,
        exp: expiresAt,
      })
    ).toString("base64url"),
    "unsigned_synthetic_unit_only",
  ].join("."),
  refresh_token: "synthetic-refresh-unit-only",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: expiresAt,
  user: {
    id: accountId,
    email,
    aud: "authenticated",
    is_anonymous: false,
    email_confirmed_at: "2026-10-01T00:00:00Z",
  },
});
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "native-captcha");
  vi.stubEnv("FOUNDATION_SUPABASE_URL", config.url);
  vi.stubEnv("FOUNDATION_PROJECT_REF", ref);
  vi.stubEnv("FOUNDATION_SUPABASE_PUBLISHABLE_KEY", config.publishableKey);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  fetcher.mockImplementation(async () => Response.json(session()));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function expectPrivate(response: Response) {
  for (const name of ["Cache-Control", "CDN-Cache-Control", "Cloudflare-CDN-Cache-Control"])
    expect(response.headers.get(name)).toContain("no-store");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("Expires")).toBe("0");
}

it("uses the real SSR/SDK transport, consuming the token in one GoTrue password call only", async () => {
  const response = await POST(request({ ...credentials, email: " Person@Example.invalid " }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expectPrivate(response);
  expect(checkRateLimit).toHaveBeenCalledExactlyOnceWith({
    key: "synthetic-ip",
    action: "auth:login",
    degradedMode: "block",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toBe(`${config.url}/auth/v1/token?grant_type=password`);
  expect(init).toMatchObject({
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    redirect: "manual",
  });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  const headers = new Headers(init?.headers);
  expect(headers.get("apikey")).toBe(config.publishableKey);
  expect(headers.has("cookie")).toBe(false);
  expect(JSON.parse(String(init?.body))).toEqual({
    email: credentials.email,
    password: credentials.password,
    gotrue_meta_security: { captcha_token: credentials.turnstileToken },
  });
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain(`sb-${ref}-auth-token=`);
  expect(cookie).not.toContain("sb-tnygdgormnofpgjknlhr");
});

it.each(["whole", "chunks"])(
  "starts a fresh account sign-in without refreshing expired %s cookies, and removes old chunks",
  async (format) => {
    const previousId = "00000000-0000-4000-8000-000000000002";
    const previous = session("previous@example.invalid", previousId, 1);
    const encoded = "base64-" + Buffer.from(JSON.stringify(previous)).toString("base64url");
    const name = `sb-${ref}-auth-token`;
    const half = Math.ceil(encoded.length / 2);
    const extraCookies =
      format === "whole"
        ? `${name}=${encoded}`
        : `${name}.0=${encoded.slice(0, half)}; ${name}.1=${encoded.slice(half)}`;
    fetcher.mockImplementation(async (url) =>
      Response.json(
        new URL(String(url)).searchParams.get("grant_type") === "refresh_token"
          ? session("previous@example.invalid", previousId)
          : session()
      )
    );
    const response = await POST(request(credentials, { extraCookies }));
    // Initial-session subscribers must settle without refreshing old identity.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      `${config.url}/auth/v1/token?grant_type=password`
    );
    const value = response.cookies.get(name)!.value;
    expect(JSON.parse(Buffer.from(value.slice(7), "base64url").toString()).user.id).toBe(id);
    if (format === "chunks")
      for (const suffix of [".0", ".1"])
        expect(response.cookies.get(name + suffix)).toMatchObject({ value: "", maxAge: 0 });
  }
);
it("keeps the previous browser session unchanged when the new credentials are refused", async () => {
  const name = `sb-${ref}-auth-token`;
  const previous =
    "base64-" +
    Buffer.from(JSON.stringify(session("previous@example.invalid", id, 1))).toString("base64url");
  fetcher.mockImplementation(async () =>
    Response.json({ code: "invalid_credentials", msg: "refused" }, { status: 400 })
  );
  const response = await POST(request(credentials, { extraCookies: `${name}=${previous}` }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(response.status).toBe(401);
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([undefined, "", "app-siteverify"])(
  "stays closed without the explicit native integration mode: %s",
  async (mode) => {
    vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", mode);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it.each([{ origin: "https://other.example" }, { validCsrf: false }])(
  "rejects unsafe requests before provider access %#",
  async (options) => {
    const response = await POST(request(credentials, options));
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it.each(["tnygdgormnofpgjknlhr", "abcdefghijklmnopqrst"])(
  "cannot fall back to another runtime project %s",
  async (other) => {
    vi.stubEnv("FOUNDATION_SUPABASE_URL", `https://${other}.supabase.co`);
    vi.stubEnv("FOUNDATION_PROJECT_REF", other);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it.each([
  [{ limited: true, retryAfter: 90 }, 429],
  [{ limited: true, degraded: true, retryAfter: 90 }, 503],
  [{ limited: false, degraded: true, retryAfter: 90 }, 503],
] as const)("blocks limited or degraded protection %#", async (limit, status) => {
  vi.mocked(checkRateLimit).mockResolvedValue(limit);
  const response = await POST(request());
  expect(response.status).toBe(status);
  expect(response.headers.get("Retry-After")).toBe("90");
  expectPrivate(response);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  {},
  { ...credentials, turnstileToken: "" },
  { ...credentials, turnstileToken: " " },
  { ...credentials, turnstileToken: "turnstile-unavailable" },
  { ...credentials, turnstileToken: "dev-turnstile-bypass" },
  { ...credentials, turnstileToken: "x".repeat(2049) },
  { ...credentials, password: "x".repeat(129) },
  { ...credentials, email: "invalid" },
  { ...credentials, role: "admin" },
  "invalid-json",
  JSON.stringify({ padding: "x".repeat(4096) }),
])(
  "rejects invalid, oversized or authority-bearing input without any provider call %#",
  async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it.each([
  [400, 401],
  [401, 401],
  [403, 401],
  [422, 401],
  [429, 429],
  [500, 503],
  [503, 503],
])(
  "sanitizes provider failure %s into %s, without retries or cookies",
  async (upstream, expected) => {
    fetcher.mockImplementation(async () =>
      Response.json(
        { msg: "PRIVATE_PROVIDER_DIAGNOSTIC", code: "captcha_failed" },
        { status: upstream }
      )
    );
    const response = await POST(request());
    expect(response.status).toBe(expected);
    expect(await response.text()).not.toContain("PRIVATE_PROVIDER_DIAGNOSTIC");
    expectPrivate(response);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
);
it.each(["anonymous", "unconfirmed", "bad-id"])(
  "discards staged session cookies on an invalid successful provider response: %s",
  async (kind) => {
    const data = session();
    if (kind === "anonymous") data.user.is_anonymous = true;
    if (kind === "unconfirmed") data.user.email_confirmed_at = "";
    if (kind === "bad-id") data.user.id = "invalid";
    fetcher.mockImplementation(async () => Response.json(data));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
);
it.each([
  [config, true],
  [{ ...config, url: "http://127.0.0.1:55441", expectedProjectRef: "local-foundation" }, false],
] as const)(
  "sets hosted HTTPS-only cookies while allowing the isolated local HTTP test server %#",
  async (connection, secure) => {
    const writes = vi.fn();
    await signInFoundationPassword(
      connection,
      credentials,
      { getAll: () => [], setAll: writes },
      fetcher
    );
    expect(writes).toHaveBeenCalled();
    expect(
      writes.mock.calls
        .flatMap(([items]) => items)
        .every((item: { options: { secure?: boolean } }) => item.options.secure === secure)
    ).toBe(true);
  }
);
it.each(["read", "write"])(
  "fails closed when the cookie adapter cannot %s, without an unhandled subscriber rejection",
  async (kind) => {
    await expect(
      signInFoundationPassword(
        config,
        credentials,
        {
          getAll: () => {
            if (kind === "read") throw new Error("private cookie failure");
            return [];
          },
          setAll: () => {
            if (kind === "write") throw new Error("private cookie failure");
          },
        },
        fetcher
      )
    ).rejects.toMatchObject({ status: 503, message: "Sign-in is temporarily unavailable" });
  }
);
it("isolates concurrent sign-ins and their outgoing session cookies", async () => {
  fetcher.mockImplementation(async (_url, init) =>
    Response.json(session(JSON.parse(String(init?.body)).email))
  );
  const emails = ["one@example.invalid", "two@example.invalid"];
  const responses = await Promise.all(
    emails.map((email) => POST(request({ ...credentials, email })))
  );
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  const values = responses.map((response) => response.cookies.get(`sb-${ref}-auth-token`)!.value);
  expect(
    values.map(
      (value) => JSON.parse(Buffer.from(value.slice(7), "base64url").toString()).user.email
    )
  ).toEqual(emails);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
