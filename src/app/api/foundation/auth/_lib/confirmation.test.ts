/** @vitest-environment node */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/(auth)/auth/callback/route";
import { POST as register } from "../register/route";
import { POST as requestRecovery } from "../recovery/request/route";
import { readRecoveryBinding } from "@/lib/foundation/recovery-binding";
import { handleFoundationGoogleOAuth } from "./google-oauth";
import { handleFoundationConfirmation } from "./confirmation";
import { createClient as legacyClient } from "@/lib/supabase/server";
import { createAdminClient as legacyAdmin } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/security/pwned-passwords", () => ({
  isPwnedPassword: async () => false,
  PWNED_PASSWORD_ERROR: "Known breached password",
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "confirmation-client" }),
}));

const target = "gntzjtuncsyefujajmjy";
const authUrl = `https://${target}.supabase.co/auth/v1`;
const baseCookie = `sb-${target}-auth-token`;
const csrf = "c".repeat(64);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const flows: Array<{
  id: string;
  code: string;
  challenge: string;
  user: number;
  used: boolean;
  recovery?: boolean;
}> = [];
const issued = new Map<string, number>();
const googleUsers = new Set<number>();
const fetcher = vi.fn<typeof fetch>();
const user = (n: number) => ({
  id: uuid(n),
  email: `person${n}@example.invalid`,
  aud: "authenticated",
  email_confirmed_at: "2026-10-24T00:00:00Z",
  is_anonymous: false,
  identities: googleUsers.has(n)
    ? [
        {
          id: uuid(n),
          user_id: uuid(n),
          provider: "google",
          identity_id: uuid(n),
          created_at: "2026-10-24T00:00:00Z",
          updated_at: "2026-10-24T00:00:00Z",
        },
      ]
    : [],
});
function session(n: number, recovery = false) {
  const token = [
    Buffer.from('{"alg":"ES256"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        iss: authUrl,
        sub: uuid(n),
        session_id: uuid(100 + n),
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...(recovery
          ? { amr: [{ method: "recovery", timestamp: Math.floor(Date.now() / 1000) }] }
          : {}),
      })
    ).toString("base64url"),
    "unsigned_synthetic_unit_only",
  ].join(".");
  issued.set(token, n);
  return {
    access_token: token,
    refresh_token: "synthetic-refresh-" + n,
    expires_in: 3600,
    token_type: "bearer",
    user: user(n),
  };
}
function applyCookies(
  jar: Map<string, string>,
  cookies: Array<{ name: string; value: string; maxAge?: number }>
) {
  for (const cookie of cookies) {
    if (cookie.maxAge === 0) jar.delete(cookie.name);
    else jar.set(cookie.name, cookie.value);
  }
}
function headers(jar: Map<string, string>) {
  return { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}
async function begin(jar: Map<string, string>, n = 1) {
  const response = await register(
    new NextRequest("https://verifymzansi.com/api/foundation/auth/register", {
      method: "POST",
      headers: {
        ...headers(jar),
        origin: "https://verifymzansi.com",
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: `person${n}@example.invalid`,
        displayName: "Thando M.",
        password: "synthetic-long-password",
        confirmPassword: "synthetic-long-password",
        acceptTerms: true,
        turnstileToken: "synthetic-captcha",
      }),
    })
  );
  expect(response.status).toBe(200);
  applyCookies(jar, response.cookies.getAll());
  return flows.at(-1)!;
}
function link(flow: (typeof flows)[number], suffix = "") {
  return `https://verifymzansi.com/auth/callback?backend=foundation&code=${flow.code}&sb_flow_id=${flow.id}${suffix}`;
}
beforeEach(() => {
  vi.clearAllMocks();
  flows.length = 0;
  issued.clear();
  googleUsers.clear();
  for (const [key, value] of Object.entries({
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_REGISTRATION_ENABLED: "true",
    FOUNDATION_SUPABASE_URL: `https://${target}.supabase.co`,
    FOUNDATION_PROJECT_REF: target,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  }))
    vi.stubEnv(key, value);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  fetcher.mockImplementation(async (url, init) => {
    const request = new URL(String(url));
    expect(request.origin + "/auth/v1").toBe(authUrl);
    if (request.pathname.endsWith("/settings"))
      return Response.json({ external: { google: true } });
    if (request.pathname.endsWith("/signup")) {
      const body = JSON.parse(String(init?.body));
      const redirect = new URL(request.searchParams.get("redirect_to")!);
      const n = flows.length + 1;
      flows.push({
        id: redirect.searchParams.get("sb_flow_id")!,
        code: "synthetic_code_" + n,
        challenge: body.code_challenge,
        user: n,
        used: false,
      });
      return Response.json({ ...user(n), email_confirmed_at: null });
    }
    if (request.pathname.endsWith("/token")) {
      expect(request.searchParams.get("grant_type")).toBe("pkce");
      const body = JSON.parse(String(init?.body));
      const flow = flows.find((flow) => flow.code === body.auth_code);
      const challenge = createHash("sha256").update(body.code_verifier).digest("base64url");
      if (!flow || flow.used || flow.challenge !== challenge)
        return Response.json({ msg: "PRIVATE_CODE_REFUSAL" }, { status: 400 });
      flow.used = true;
      return Response.json(session(flow.user, flow.recovery));
    }
    if (request.pathname.endsWith("/recover")) {
      const body = JSON.parse(String(init?.body));
      const redirect = new URL(request.searchParams.get("redirect_to")!);
      flows.push({
        id: redirect.searchParams.get("sb_flow_id")!,
        code: "synthetic_recovery_code_" + (flows.length + 1),
        challenge: body.code_challenge,
        user: Number(String(body.email).match(/^person([0-9]+)@/)![1]),
        used: false,
        recovery: true,
      });
      return Response.json({});
    }
    if (request.pathname === "/rest/v1/rpc/get_my_profile")
      return Response.json({
        display_name: "Thando M.",
        public_name: "Thando M.",
        bio: null,
        avatar_object_id: null,
        legal_first_name: null,
        legal_last_name: null,
        legal_name_locked: false,
        identity_verified: false,
        revision: 1,
        updated_at: "2026-10-25T00:00:00Z",
      });
    expect(request.pathname).toBe("/auth/v1/user");
    const n = issued.get(new Headers(init?.headers).get("authorization")!.slice(7));
    return n ? Response.json(user(n)) : Response.json({ msg: "refused" }, { status: 401 });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function beginGoogle(jar: Map<string, string>, returnUrl = "/dashboard") {
  const response = await handleFoundationGoogleOAuth(
    new NextRequest("https://verifymzansi.com/api/auth/oauth/google", {
      method: "POST",
      headers: {
        ...headers(jar),
        origin: "https://verifymzansi.com",
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ returnUrl }),
    })
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  applyCookies(jar, response.cookies.getAll());
  expect(response.cookies.getAll().every((cookie) => cookie.secure)).toBe(true);
  const authorization = new URL((await response.json()).url);
  expect(authorization.origin + authorization.pathname).toBe(`${authUrl}/authorize`);
  expect(authorization.searchParams.get("provider")).toBe("google");
  expect(authorization.searchParams.get("code_challenge_method")).toBe("s256");
  const callback = new URL(authorization.searchParams.get("redirect_to")!);
  const flow = {
    id: callback.searchParams.get("sb_flow_id")!,
    code: "synthetic_google_code",
    challenge: authorization.searchParams.get("code_challenge")!,
    user: 1,
    used: false,
  };
  expect(flow.id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  flows.push(flow);
  callback.searchParams.set("code", flow.code);
  return callback;
}

it("completes Google PKCE in the target project and preserves a safe return path", async () => {
  const jar = new Map([["vm_csrf", csrf]]);
  const callback = await beginGoogle(jar, "/dashboard/profile");
  googleUsers.add(1);
  const response = await GET(new NextRequest(callback, { headers: headers(jar) }));
  expect(response.headers.get("location")).toBe("https://verifymzansi.com/dashboard/profile");
  expect(response.cookies.get(baseCookie)?.secure).toBe(true);
  expect(response.cookies.get("vm_password_recovery")).toBeUndefined();
  expect(legacyClient).not.toHaveBeenCalled();
  expect(legacyAdmin).not.toHaveBeenCalled();
});

it("does not redirect Google sign-in to an external return URL", async () => {
  const jar = new Map([["vm_csrf", csrf]]);
  const callback = await beginGoogle(jar, "https://other.example/");
  googleUsers.add(1);
  const response = await GET(new NextRequest(callback, { headers: headers(jar) }));
  expect(response.headers.get("location")).toBe("https://verifymzansi.com/");
});

it("does not publish Google callback sessions without a verified Google identity", async () => {
  const jar = new Map([["vm_csrf", csrf]]);
  const callback = await beginGoogle(jar);
  const response = await GET(new NextRequest(callback, { headers: headers(jar) }));
  expect(response.headers.get("location")).toContain("auth_callback_failed");
  expect(response.cookies.get(baseCookie)).toBeUndefined();
});

it("fails privately without verifier cookies when the target Google provider is disabled", async () => {
  fetcher.mockResolvedValue(Response.json({ external: { google: false } }));
  const response = await handleFoundationGoogleOAuth(
    new NextRequest("https://verifymzansi.com/api/auth/oauth/google", {
      method: "POST",
      headers: {
        ...headers(new Map([["vm_csrf", csrf]])),
        origin: "https://verifymzansi.com",
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ returnUrl: "/dashboard" }),
    })
  );
  expect(response.status).toBe(503);
  expect(response.cookies.getAll()).toEqual([]);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});

it("a client recovery selector cannot turn a signup code into password-recovery authority", async () => {
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  const jar = new Map([["vm_csrf", csrf]]);
  const flow = await begin(jar);
  const slot = `${baseCookie}-flow-${flow.id}-code-verifier`;
  const original = JSON.parse(Buffer.from(jar.get(slot)!.slice(7), "base64url").toString());
  jar.set(
    slot,
    "base64-" + Buffer.from(JSON.stringify(original + "/recovery")).toString("base64url")
  );
  const response = await GET(new NextRequest(link(flow, "&recovery=1"), { headers: headers(jar) }));
  expect(response.headers.get("location")).toBe(
    "https://verifymzansi.com/forgot-password?error=recovery_failed"
  );
  expect(
    response.cookies
      .getAll()
      .filter((item) => item.name === baseCookie || item.name.startsWith(baseCookie + "."))
  ).toEqual([]);
  expect(legacyClient).not.toHaveBeenCalled();
  expect(legacyAdmin).not.toHaveBeenCalled();
});

it("confirms the selected signup PKCE flow and verifies the new account without any source-profile access", async () => {
  const jar = new Map([["vm_csrf", csrf]]);
  const flow = await begin(jar);
  fetcher.mockClear();
  const response = await GET(
    new NextRequest(link(flow, "&next=https://other.example/"), { headers: headers(jar) })
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://verifymzansi.com/dashboard/complete-profile"
  );
  const destination = new URL(response.headers.get("location")!);
  expect(
    existsSync(`src/app${destination.pathname}/page.tsx`),
    "Confirmation destination has a real page"
  ).toBe(true);
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(response.cookies.get(baseCookie)?.secure).toBe(true);
  expect(response.cookies.get("vm_password_recovery")).toBeUndefined();
  expect(legacyClient).not.toHaveBeenCalled();
  expect(legacyAdmin).not.toHaveBeenCalled();
});
it("keeps concurrent confirmation flows separate even when the legacy verifier slot belongs to the newer flow", async () => {
  const jar = new Map([["vm_csrf", csrf]]);
  const first = await begin(jar, 1);
  const second = await begin(jar, 2);
  const firstResponse = await GET(new NextRequest(link(first), { headers: headers(jar) }));
  expect(firstResponse.headers.get("location")).toContain("/dashboard/complete-profile");
  applyCookies(jar, firstResponse.cookies.getAll());
  expect(jar.has(`${baseCookie}-flow-${second.id}-code-verifier`)).toBe(true);
  const secondResponse = await GET(new NextRequest(link(second), { headers: headers(jar) }));
  expect(secondResponse.headers.get("location")).toContain("/dashboard/complete-profile");
  const value = secondResponse.cookies.get(baseCookie)!.value;
  expect(JSON.parse(Buffer.from(value.slice(7), "base64url").toString()).user.id).toBe(uuid(2));
});
it("cannot borrow another flow's verifier when a supplied flow id is unknown", async () => {
  const jar = new Map([["vm_csrf", csrf]]);
  const flow = await begin(jar);
  fetcher.mockClear();
  const response = await GET(
    new NextRequest(link({ ...flow, id: "unknown_flow_id" }), { headers: headers(jar) })
  );
  expect(response.headers.get("location")).toContain("auth_callback_failed");
  expect(response.cookies.get(baseCookie)).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not publish a session when a consumed code is replayed", async () => {
  const jar = new Map([["vm_csrf", csrf]]);
  const flow = await begin(jar);
  expect(
    (await GET(new NextRequest(link(flow), { headers: headers(jar) }))).headers.get("location")
  ).toContain("/dashboard/complete-profile");
  fetcher.mockClear();
  const response = await GET(new NextRequest(link(flow), { headers: headers(jar) }));
  expect(response.headers.get("location")).toContain("auth_callback_failed");
  expect(response.cookies.get(baseCookie)).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(response.cookies.get(`${baseCookie}-flow-${flow.id}-code-verifier`)).toMatchObject({
    value: "",
    maxAge: 0,
  });
});
it("a caller-editable recovery marker never grants a password-recovery session", async () => {
  const jar = new Map([["vm_csrf", csrf]]);
  const flow = await begin(jar);
  const key = `${baseCookie}-flow-${flow.id}-code-verifier`;
  const verifier = JSON.parse(Buffer.from(jar.get(key)!.slice(7), "base64url").toString());
  jar.set(
    key,
    "base64-" + Buffer.from(JSON.stringify(verifier + "/recovery")).toString("base64url")
  );
  const response = await GET(new NextRequest(link(flow), { headers: headers(jar) }));
  expect(response.headers.get("location")).toContain("auth_callback_failed");
  expect(response.cookies.get(baseCookie)).toBeUndefined();
  expect(response.cookies.get("vm_password_recovery")).toBeUndefined();
});
it.each(["missing-flow", "duplicate-code", "token-hash"])(
  "rejects malformed foundation callbacks before any provider call: %s",
  async (kind) => {
    const url = new URL(
      "https://verifymzansi.com/auth/callback?backend=foundation&code=synthetic_code&sb_flow_id=synthetic_flow"
    );
    if (kind === "missing-flow") url.searchParams.delete("sb_flow_id");
    if (kind === "duplicate-code") url.searchParams.append("code", "second_code");
    if (kind === "token-hash") url.searchParams.set("token_hash", "synthetic_hash");
    const response = await GET(new NextRequest(url));
    expect(response.headers.get("location")).toContain("auth_callback_failed");
    expect(fetcher).not.toHaveBeenCalled();
    expect(legacyClient).not.toHaveBeenCalled();
  }
);
it("stays closed without the callback flag and blocks degraded shared protection", async () => {
  const jar = new Map([["vm_csrf", csrf]]);
  const flow = await begin(jar);
  fetcher.mockClear();
  vi.stubEnv("FOUNDATION_AUTH_CALLBACK_ENABLED", "");
  expect(
    (await GET(new NextRequest(link(flow), { headers: headers(jar) }))).headers.get("location")
  ).toContain("auth_callback_failed");
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("FOUNDATION_AUTH_CALLBACK_ENABLED", "true");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, degraded: true, retryAfter: 90 });
  const response = await GET(new NextRequest(link(flow), { headers: headers(jar) }));
  expect(response.headers.get("Retry-After")).toBe("90");
  expect(fetcher).not.toHaveBeenCalled();
});

async function beginRecovery(jar: Map<string, string>, n = 1) {
  const response = await requestRecovery(
    new NextRequest("https://verifymzansi.com/api/foundation/auth/recovery/request", {
      method: "POST",
      headers: {
        ...headers(jar),
        origin: "https://verifymzansi.com",
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: `person${n}@example.invalid`,
        turnstileToken: "synthetic-captcha",
      }),
    })
  );
  expect(response.status).toBe(200);
  applyCookies(jar, response.cookies.getAll());
  const flow = flows.at(-1)!;
  expect(flow.recovery).toBe(true);
  return flow;
}
const BINDING = "__Host-vm_recovery_binding";

it("remembers which verified recovery session a reset link opened, in this browser only", async () => {
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
  const jar = new Map([["vm_csrf", csrf]]);
  const flow = await beginRecovery(jar);
  const response = await GET(new NextRequest(link(flow, "&recovery=1"), { headers: headers(jar) }));
  const location = new URL(response.headers.get("location")!);
  expect(location.origin + location.pathname).toBe("https://verifymzansi.com/reset-password");
  expect([...location.searchParams.keys()]).toEqual(["link"]);
  const marker = location.searchParams.get("link")!;
  expect(marker).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.cookies.get(baseCookie)?.secure).toBe(true);
  const cookie = response.cookies.get(BINDING)!;
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict", path: "/" });
  expect(cookie.domain).toBeUndefined();
  expect(cookie.maxAge).toBeGreaterThan(1790);
  expect(cookie.maxAge).toBeLessThanOrEqual(1800);
  // Bound to the account and session GoTrue issued for this link.
  expect(readRecoveryBinding(cookie.value)).toMatchObject({
    account: uuid(1),
    session: uuid(101),
    marker,
  });
  expect(response.cookies.get("vm_password_recovery")).toBeUndefined();
  expect(legacyClient).not.toHaveBeenCalled();
});

it("gives every opened link its own page address and binding", async () => {
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
  const jar = new Map([["vm_csrf", csrf]]);
  const first = await beginRecovery(jar);
  const second = await beginRecovery(jar);
  const a = await GET(new NextRequest(link(first, "&recovery=1"), { headers: headers(jar) }));
  applyCookies(jar, a.cookies.getAll());
  const b = await GET(new NextRequest(link(second, "&recovery=1"), { headers: headers(jar) }));
  const markerA = new URL(a.headers.get("location")!).searchParams.get("link");
  const markerB = new URL(b.headers.get("location")!).searchParams.get("link");
  expect(markerA).not.toBe(markerB);
  // The later link replaces the binding; the earlier page no longer matches it.
  expect(readRecoveryBinding(b.cookies.get(BINDING)!.value)?.marker).toBe(markerB);
});

it("publishes no recovery session when the binding cannot be signed", async () => {
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  vi.stubEnv("HMAC_SECRET", "");
  const jar = new Map([["vm_csrf", csrf]]);
  const flow = await beginRecovery(jar);
  const response = await GET(new NextRequest(link(flow, "&recovery=1"), { headers: headers(jar) }));
  expect(response.headers.get("location")).toBe(
    "https://verifymzansi.com/forgot-password?error=recovery_failed"
  );
  expect(response.cookies.get(BINDING)).toBeUndefined();
  expect(
    response.cookies
      .getAll()
      .filter((item) => item.name === baseCookie || item.name.startsWith(baseCookie + "."))
  ).toEqual([]);
});

it("never binds recovery for sign-up confirmations or refused recovery links", async () => {
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
  const jar = new Map([["vm_csrf", csrf]]);
  const signup = await begin(jar);
  const confirmed = await GET(new NextRequest(link(signup), { headers: headers(jar) }));
  expect(confirmed.headers.get("location")).toContain("/dashboard/complete-profile");
  expect(confirmed.cookies.get(BINDING)).toBeUndefined();
  // A sign-up code presented as recovery has no signed recovery method.
  const other = await begin(jar, 2);
  const refused = await GET(new NextRequest(link(other, "&recovery=1"), { headers: headers(jar) }));
  expect(refused.headers.get("location")).toContain("recovery_failed");
  expect(refused.cookies.get(BINDING)).toBeUndefined();
  // A used recovery link opens nothing and binds nothing.
  const flow = await beginRecovery(jar);
  const opened = await GET(new NextRequest(link(flow, "&recovery=1"), { headers: headers(jar) }));
  expect(opened.cookies.get(BINDING)).toBeDefined();
  const replay = await GET(new NextRequest(link(flow, "&recovery=1"), { headers: headers(jar) }));
  expect(replay.headers.get("location")).toContain("recovery_failed");
  expect(replay.cookies.get(BINDING)).toBeUndefined();
});

it("an email change selector never turns a sign-up or recovery code into a session", async () => {
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
  const jar = new Map([["vm_csrf", csrf]]);
  const signup = await begin(jar);
  const recovery = await beginRecovery(jar, 2);
  fetcher.mockClear();
  for (const url of [
    link(signup, "&email_change=1"),
    link(recovery, "&recovery=1&email_change=1"),
    // The landing's own shape (no flow selector), with a real sign-up code.
    `https://verifymzansi.com/auth/callback?backend=foundation&email_change=1&code=${signup.code}`,
  ]) {
    const response = await GET(new NextRequest(url, { headers: headers(jar) }));
    expect(response.status).toBe(303);
    // Only a page is chosen: no exchange, no session, no binding, no verifier change.
    expect(response.cookies.getAll()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  }
  expect(signup.used).toBe(false);
  expect(recovery.used).toBe(false);
  // Even handed straight to the session handler, such a link opens nothing.
  for (const [url, purpose] of [
    [link(signup, "&email_change=1"), "signup"],
    [link(recovery, "&recovery=1&email_change=1"), "recovery"],
  ] as const) {
    const direct = await handleFoundationConfirmation(
      new NextRequest(url, { headers: headers(jar) }),
      purpose
    );
    expect(direct.headers.get("location")).toMatch(/auth_callback_failed|recovery_failed/);
    expect(direct.cookies.getAll().filter((item) => item.value)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  }
  // The same links without the selector still work as before.
  const confirmed = await GET(new NextRequest(link(signup), { headers: headers(jar) }));
  expect(confirmed.headers.get("location")).toContain("/dashboard/complete-profile");
  const opened = await GET(
    new NextRequest(link(recovery, "&recovery=1"), { headers: headers(jar) })
  );
  expect(opened.cookies.get(BINDING)).toBeDefined();
  expect(legacyClient).not.toHaveBeenCalled();
  expect(legacyAdmin).not.toHaveBeenCalled();
});
