// @vitest-environment node
// The staff route that still finishes on the retired backend, through the
// real staff-session -> request-route -> request-api -> admin-access ->
// staff-mfa chain. Only fetch is replaced: a small model of Auth (user,
// token refresh) and of api.get_my_account_context, whose `can_access`
// mirrors internal.staff_actor.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.unmock("@/lib/auth/staff-mfa-guard");
vi.mock("@/lib/hidden-features", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  SHOW_ORGANISATION_REPORT: true,
}));
const legacy = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: legacy.getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: legacy.rpc, from: legacy.from }),
}));

import { GET as exportReport } from "@/app/api/organisations/[id]/report/route";

const BACKEND = "http://127.0.0.1:55441";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const AUTH_COOKIE = "sb-127-auth-token";
const now = () => Math.floor(Date.now() / 1000);
const b64u = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as Record<string, unknown>;

const CAPABILITIES: Record<string, string[]> = {
  governor: ["decision:approve", "queue:view"],
  admin: ["decision:approve", "organisation:manage", "queue:view", "role:manage"],
};
let role: "governor" | "admin" | null;
let refreshTo: string | null;
let calls: string[];

function token(claims: Record<string, unknown> = {}) {
  return `${b64u({ alg: "ES256", typ: "JWT" })}.${b64u({
    iss: `${BACKEND}/auth/v1`,
    sub: ACCOUNT,
    aud: "authenticated",
    role: "authenticated",
    session_id: SESSION,
    exp: now() + 3600,
    aal: "aal2",
    amr: [
      { method: "password", timestamp: now() - 120 },
      { method: "totp", timestamp: now() - 60 },
    ],
    is_anonymous: false,
    ...claims,
  })}.signed`;
}

/** The session cookie the browser holds; an expired one makes the SDK refresh. */
function sessionCookie(access: string, expiresAt = now() + 3600) {
  const session = {
    access_token: access,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: "refresh-1",
    user: { id: ACCOUNT, aud: "authenticated" },
  };
  return `${AUTH_COOKIE}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}
const expiredSessionCookie = () => sessionCookie(token({ exp: now() - 10 }), now() - 10);

/** internal.staff_actor('queue:view') as get_my_account_context runs it. */
function canAccess(claims: Record<string, unknown>) {
  const amr = Array.isArray(claims.amr)
    ? (claims.amr as { method: string; timestamp: number }[])
    : [];
  const totp = Math.max(0, ...amr.filter((a) => a.method === "totp").map((a) => a.timestamp));
  return claims.aal === "aal2" && totp >= now() - 12 * 3600 && role !== null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function backend(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  const bearer = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
  calls.push(url.pathname);
  if (url.origin !== BACKEND) throw new Error(`unexpected host ${url.origin}`);
  if (url.pathname === "/auth/v1/token") {
    if (!refreshTo) return json({ code: 400, error_code: "refresh_token_not_found" }, 400);
    return json({
      access_token: refreshTo,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now() + 3600,
      refresh_token: "refresh-2",
      user: { id: ACCOUNT, aud: "authenticated" },
    });
  }
  const claims = decode(bearer);
  if (url.pathname === "/auth/v1/user") {
    if ((claims.exp as number) <= now()) return json({ code: 403, error_code: "bad_jwt" }, 403);
    return json({
      id: claims.sub,
      aud: "authenticated",
      role: "authenticated",
      email: "staff@example.test",
      app_metadata: { provider: "email" },
      user_metadata: {},
      factors: [{ id: "f", factor_type: "totp", status: "verified" }],
      is_anonymous: false,
      created_at: "2026-11-01T00:00:00Z",
    });
  }
  if (url.pathname === "/rest/v1/rpc/get_my_account_context") {
    return json({
      version: 1,
      account_id: claims.sub,
      email: "staff@example.test",
      phone: null,
      profile: {
        display_name: null,
        public_name: null,
        bio: null,
        avatar_object_id: null,
        legal_first_name: null,
        legal_last_name: null,
        legal_name_locked: false,
        identity_verified: false,
        revision: 1,
        updated_at: "2026-11-01T00:00:00Z",
      },
      totp_enrolled: true,
      staff: role
        ? { role, can_access: canAccess(claims), assigned_capabilities: CAPABILITIES[role] }
        : null,
    });
  }
  throw new Error(`unexpected ${url.pathname}`);
}

beforeEach(() => {
  vi.stubEnv("FOUNDATION_SUPABASE_URL", BACKEND);
  vi.stubEnv("FOUNDATION_PROJECT_REF", "local-foundation");
  vi.stubEnv("FOUNDATION_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("ENVIRONMENT", "development");
  vi.stubGlobal("fetch", vi.fn(backend));
  role = "admin";
  refreshTo = null;
  calls = [];
  legacy.getUser.mockReset().mockResolvedValue({ data: { user: { id: ACCOUNT } } });
  legacy.rpc.mockReset();
  legacy.from.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const expectRefreshedPrivateReply = (response: Response) => {
  expect(calls).toContain("/auth/v1/token");
  expect(response.headers.get("set-cookie") ?? "").toContain(AUTH_COOKIE);
  expect(response.headers.get("cache-control")).toContain("no-store");
};

describe("GET /api/organisations/:id/report (staff branch)", () => {
  const report = (cookie: string | null) =>
    exportReport(
      new NextRequest(`https://verifymzansi.com/api/organisations/${ORG}/report?days=30`, {
        headers: cookie ? { cookie } : {},
      }),
      { params: Promise.resolve({ id: ORG }) }
    );
  const organisation = (found: boolean) => {
    legacy.rpc.mockImplementation(async (name: string) =>
      name === "is_organisation_admin"
        ? { data: false, error: null }
        : name === "org_list_members"
          ? { data: [], error: null }
          : { data: { participatingBusinesses: 2 }, error: null }
    );
    legacy.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: found ? { name: "Programme", slug: "programme", trial_starts_at: null } : null,
          }),
        }),
      }),
    });
  };

  it("exports the CSV with the refreshed session cookie and no-store headers", async () => {
    organisation(true);
    refreshTo = token();
    const response = await report(expiredSessionCookie());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="programme-/
    );
    expectRefreshedPrivateReply(response);
  });

  it("sends the refreshed cookie with a later refusal (404)", async () => {
    organisation(false);
    refreshTo = token();
    const response = await report(expiredSessionCookie());
    expect(response.status).toBe(404);
    expectRefreshedPrivateReply(response);
  });

  it("refuses a governor, who lacks organisation:manage", async () => {
    organisation(true);
    role = "governor";
    const response = await report(sessionCookie(token()));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Organisation access required" });
  });

  it("sends an admin whose authenticator code is over 12 hours old to verify again", async () => {
    organisation(true);
    const response = await report(
      sessionCookie(token({ amr: [{ method: "totp", timestamp: now() - 12 * 3600 - 60 }] }))
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "mfa_required",
      verifyUrl: "/staff/two-step",
    });
  });

  it("refuses when the signed-in user and the live-backend caller differ", async () => {
    organisation(true);
    legacy.getUser.mockResolvedValue({
      data: { user: { id: "55555555-5555-4555-8555-555555555555" } },
    });
    const response = await report(sessionCookie(token()));
    expect(response.status).toBe(403);
    expect(calls).not.toContain("/rest/v1/rpc/get_my_account_context");
  });

  it("answers 401 without a live-backend session", async () => {
    organisation(true);
    const response = await report(null);
    expect(response.status).toBe(401);
  });
});
