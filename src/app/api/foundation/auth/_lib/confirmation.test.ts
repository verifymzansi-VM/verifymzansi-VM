/** @vitest-environment node */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/(auth)/auth/callback/route";
import { POST as register } from "../register/route";
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
const flows: Array<{ id: string; code: string; challenge: string; user: number; used: boolean }> =
  [];
const issued = new Map<string, number>();
const fetcher = vi.fn<typeof fetch>();
const user = (n: number) => ({
  id: uuid(n),
  email: `person${n}@example.invalid`,
  aud: "authenticated",
  email_confirmed_at: "2026-10-24T00:00:00Z",
  is_anonymous: false,
});
function session(n: number) {
  const token = [
    Buffer.from('{"alg":"ES256"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        iss: authUrl,
        sub: uuid(n),
        session_id: uuid(100 + n),
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
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
      return Response.json(session(flow.user));
    }
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
  expect(response.headers.get("location")).toContain("confirmation_failed");
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
  expect(response.headers.get("location")).toContain("confirmation_failed");
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
  expect(response.headers.get("location")).toContain("confirmation_failed");
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
    expect(response.headers.get("location")).toContain("confirmation_failed");
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
  ).toContain("confirmation_failed");
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("FOUNDATION_AUTH_CALLBACK_ENABLED", "true");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, degraded: true, retryAfter: 90 });
  const response = await GET(new NextRequest(link(flow), { headers: headers(jar) }));
  expect(response.headers.get("Retry-After")).toBe("90");
  expect(fetcher).not.toHaveBeenCalled();
});
