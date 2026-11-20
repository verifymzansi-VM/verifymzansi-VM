/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signed-in routes called with a missing, forged or otherwise unusable session.
 * The real route context and session check run (src/lib/foundation/
 * request-route.ts and request-api.ts); only the network is replaced, by a
 * stand-in for the foundation project's Auth service and its database API that
 * records every request. Each route must answer 401 (or 503 when Auth cannot be
 * reached) and never call the database.
 */

// Every hidden feature on, so a route hidden at launch is still checked.
vi.mock("@/lib/hidden-features", async (original) => {
  const real = await original<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([key, value]) => [key, typeof value === "boolean" ? true : value])
  );
});
vi.mock("@/lib/security/security-events", () => ({
  recordSecurityEvent: vi.fn(),
  securityContext: () => ({}),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("retired backend");
  },
}));

// Each sweep calls every route; the coverage lane in CI runs several times slower.
vi.setConfig({ testTimeout: 60_000 });

const SITE = "https://verifymzansi.com";
const PROJECT = "http://127.0.0.1:55441";
const COOKIE = "sb-127-auth-token";
const LIMITER = "https://limiter.invalid/check";
const TOKEN = "c3".repeat(32);
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const ID = "11111111-1111-4111-8111-111111111111";

type Handler = (request: NextRequest, context: unknown) => Promise<Response>;
/** Signed-in routes; each body is shaped for the route, so only the session
 * can stop it. */
const ROUTES: Array<[string, string, () => Promise<Record<string, unknown>>, unknown]> = [
  [
    "profile/update",
    "POST",
    () => import("@/app/api/profile/update/route"),
    { displayName: "Thando", bio: "Hi", expectedRevision: 1 },
  ],
  ["appeals", "POST", () => import("@/app/api/appeals/route"), { reason: "x".repeat(40) }],
  ["notifications", "PATCH", () => import("@/app/api/notifications/route"), { ids: [ID] }],
  ["account/delete", "POST", () => import("@/app/api/account/delete/route"), { confirm: true }],
  ["otp/send", "POST", () => import("@/app/api/otp/send/route"), { phone: "0821234567" }],
  [
    "otp/verify",
    "POST",
    () => import("@/app/api/otp/verify/route"),
    { phone: "0821234567", otp: "123456" },
  ],
  [
    "billing/create-checkout",
    "POST",
    () => import("@/app/api/billing/create-checkout/route"),
    { planId: "starter" },
  ],
  ["listings", "POST", () => import("@/app/api/listings/route"), { title: "Bicycle" }],
  [
    "admin/content/decide",
    "POST",
    () => import("@/app/api/admin/content/decide/route"),
    { itemId: ID, area: "market", contentType: "listing", decision: "approve" },
  ],
  [
    "admin/governance/roles",
    "POST",
    () => import("@/app/api/admin/governance/roles/route"),
    { accountId: ID, role: "moderator" },
  ],
  [
    "admin/payments/ozow-refunds",
    "POST",
    () => import("@/app/api/admin/payments/ozow-refunds/route"),
    { paymentId: ID },
  ],
  [
    "admin/dsar/export",
    "POST",
    () => import("@/app/api/admin/dsar/export/route"),
    { requestId: ID },
  ],
  [
    "foundation/enquiries",
    "PATCH",
    () => import("@/app/api/foundation/enquiries/route"),
    { id: ID },
  ],
  ["auth/change-password", "POST", () => import("@/app/api/auth/change-password/route"), {}],
];

/** Every request the routes make, as "METHOD path". */
const sent: string[] = [];
let auth: (url: URL, init?: RequestInit) => Response = () => new Response(null, { status: 500 });

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", SITE);
  vi.stubEnv("FOUNDATION_SUPABASE_URL", PROJECT);
  vi.stubEnv("FOUNDATION_PROJECT_REF", "local-foundation");
  vi.stubEnv("FOUNDATION_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic");
  vi.stubEnv("FOUNDATION_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "native-captcha");
  vi.stubEnv("OTP_RATE_LIMITER_URL", LIMITER);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (url.href === LIMITER) return Response.json({ ok: true });
    sent.push(`${method} ${url.pathname}`);
    if (url.pathname.startsWith("/auth/v1/")) return auth(url, init);
    return Response.json({ message: "database reached" }, { status: 500 });
  });
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  sent.length = 0;
  auth = () => new Response(null, { status: 500 });
});

const now = () => Math.floor(Date.now() / 1000);
/** An access token with these claims and a signature only Auth can check. */
function accessToken(claims: Record<string, unknown> = {}) {
  return [
    Buffer.from('{"alg":"ES256","typ":"JWT"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: ACCOUNT,
        session_id: SESSION,
        role: "authenticated",
        iss: `${PROJECT}/auth/v1`,
        exp: now() + 3600,
        aal: "aal1",
        ...claims,
      })
    ).toString("base64url"),
    "forged-signature",
  ].join(".");
}
/** The session cookie the Auth library reads, holding this access token. */
function sessionCookie(token: string, expiresAt = now() + 3600) {
  const session = {
    access_token: token,
    refresh_token: "synthetic-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: ACCOUNT, app_metadata: { role: "admin" } },
  };
  return `${COOKIE}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}
const authUser = (id: string, extra: Record<string, unknown> = {}) =>
  Response.json({ id, aud: "authenticated", role: "authenticated", is_anonymous: false, ...extra });

async function call(
  [name, method, load, body]: (typeof ROUTES)[number],
  session: string | null
): Promise<Response> {
  const handler = (await load())[method] as Handler;
  const request = new NextRequest(`${SITE}/api/${name}`, {
    method,
    headers: {
      origin: SITE,
      "content-type": "application/json",
      "x-csrf-token": TOKEN,
      cookie: [`vm_csrf=${TOKEN}`, session].filter(Boolean).join("; "),
    },
    body: JSON.stringify(body),
  });
  return handler(request, { params: Promise.resolve({ id: ID }) });
}

const reachedDatabase = () => sent.filter((line) => !line.includes(" /auth/v1/"));

describe("signed-in routes refuse an unusable session without reaching the database", () => {
  it.each(ROUTES)("%s without a session cookie", async (...route) => {
    const response = await call(route, null);
    expect(response.status).toBe(401);
    expect(sent).toEqual([]);
  });

  it.each(ROUTES)("%s with a token Auth does not recognise", async (...route) => {
    auth = () => Response.json({ code: 403, msg: "invalid JWT" }, { status: 403 });
    const response = await call(route, sessionCookie(accessToken()));
    expect(response.status).toBe(401);
    expect(sent).toContain("GET /auth/v1/user");
    expect(reachedDatabase()).toEqual([]);
  });

  it.each(ROUTES)("%s with a token naming a different account than Auth", async (...route) => {
    auth = () => authUser(OTHER);
    const response = await call(route, sessionCookie(accessToken()));
    expect(response.status).toBe(401);
    expect(reachedDatabase()).toEqual([]);
  });

  it.each(ROUTES)("%s with an anonymous Auth user", async (...route) => {
    auth = () => authUser(ACCOUNT, { is_anonymous: true });
    const response = await call(route, sessionCookie(accessToken()));
    expect(response.status).toBe(401);
    expect(reachedDatabase()).toEqual([]);
  });

  it.each(ROUTES)("%s with a token issued by another project", async (...route) => {
    auth = () => authUser(ACCOUNT);
    const token = accessToken({ iss: "https://abcdefghijklmnopqrst.supabase.co/auth/v1" });
    const response = await call(route, sessionCookie(token));
    expect(response.status).toBe(401);
    expect(reachedDatabase()).toEqual([]);
  });

  it.each(ROUTES)("%s with an expired token that cannot be refreshed", async (...route) => {
    auth = (url) =>
      url.pathname === "/auth/v1/token"
        ? Response.json({ code: 400, msg: "Invalid Refresh Token" }, { status: 400 })
        : authUser(ACCOUNT);
    const token = accessToken({ exp: now() - 60 });
    const response = await call(route, sessionCookie(token, now() - 60));
    expect(response.status).toBe(401);
    expect(sent).not.toContain("GET /auth/v1/user");
    expect(reachedDatabase()).toEqual([]);
  });

  it.each(ROUTES)("%s with a cookie that is not a session", async (...route) => {
    const response = await call(
      route,
      `${COOKIE}=base64-${Buffer.from("{").toString("base64url")}`
    );
    expect(response.status).toBe(401);
    expect(reachedDatabase()).toEqual([]);
  });

  it.each(ROUTES)("%s while Auth is unavailable answers 503, not success", async (...route) => {
    auth = () => new Response("upstream error", { status: 502 });
    const response = await call(route, sessionCookie(accessToken()));
    expect(response.status).toBe(503);
    expect(reachedDatabase()).toEqual([]);
  });
});

describe("the same requests with a session Auth accepts", () => {
  // Without this the refusals above could pass for a route that refuses everyone.
  it.each(ROUTES)("%s gets past the session check", async (...route) => {
    auth = () => authUser(ACCOUNT, { email: "member@example.invalid" });
    const response = await call(route, sessionCookie(accessToken()));
    expect(response.status).not.toBe(401);
    expect(sent[0]).toBe("GET /auth/v1/user");
  });
});
