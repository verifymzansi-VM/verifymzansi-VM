/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every state-changing API route called by a signed-in member, from this site
 * with a valid token pair, with a body that adds fields naming another account
 * or claiming authority (accountId, owner, sender, role, actor and the like).
 * Whether a route refuses such a body or ignores the fields, the other
 * account's id must never reach a database command: the account always comes
 * from the verified session. For the routes listed in BODIES the rest of the
 * body is valid, so the request gets as far as a command. The route list is
 * read from the file system, as in mutation-route-refusals.test.ts.
 */

const work = vi.hoisted(() => ({
  commands: [] as string[],
  args: [] as Array<{ name: string; args: unknown }>,
}));
vi.mock("@/lib/hidden-features", async (original) => {
  const real = await original<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([key, value]) => [key, typeof value === "boolean" ? true : value])
  );
});
const rpc = vi.hoisted(() => async (name: string, args?: unknown) => {
  work.args.push({ name, args });
  if (name === "get_my_account_context")
    return {
      data: {
        version: 1,
        account_id: "22222222-2222-4222-8222-222222222222",
        email: "member@example.invalid",
        phone: "+27821234567",
        profile: {
          display_name: "Thando",
          public_name: "Thando",
          bio: null,
          avatar_object_id: null,
          legal_first_name: null,
          legal_last_name: null,
          legal_name_locked: false,
          identity_verified: false,
          revision: 1,
          updated_at: "2026-11-19T08:00:00Z",
        },
        totp_enrolled: false,
        staff: null,
      },
      error: null,
    };
  if (!/^(get|read|list)_/.test(name)) work.commands.push(name);
  return { data: null, error: { code: "PT503", message: "not in this test" } };
});
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/request-route", () => ({
  createFoundationRouteContext: () => {
    const caller = {
      api: { rpc },
      accountId: "22222222-2222-4222-8222-222222222222",
      sessionId: "44444444-4444-4444-8444-444444444444",
      signedInAt: Math.floor(Date.now() / 1000),
      user: { id: "22222222-2222-4222-8222-222222222222", email: "member@example.invalid" },
      openedByRecovery: false,
      recovery: null,
    };
    return {
      authenticate: async () => caller.api,
      authenticateCaller: async () => caller,
      respond: async (response: unknown) => response,
    };
  },
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: () => ({ rpc }) }));
vi.mock("@/lib/utils/rate-limit", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  checkRateLimit: async () => ({ limited: false }),
  checkSensitiveActionRateLimit: async () => ({ limited: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    work.commands.push("retired-admin");
    throw new Error("retired backend");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    work.commands.push("retired-server");
    throw new Error("retired backend");
  },
}));
vi.mock("@/lib/security/security-events", () => ({
  recordSecurityEvent: vi.fn(),
  securityContext: () => ({}),
}));

// Each sweep calls every route; the coverage lane in CI runs several times slower.
vi.setConfig({ testTimeout: 60_000 });

const SITE = "https://verifymzansi.com";
const TOKEN = "d4".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
/** Fields a page never sends that name another account or claim authority. */
const INJECTED = {
  accountId: OTHER,
  account_id: OTHER,
  userId: OTHER,
  user_id: OTHER,
  ownerId: OTHER,
  owner_id: OTHER,
  sender: OTHER,
  p_sender: OTHER,
  p_account: OTHER,
  p_actor: OTHER,
  actorId: OTHER,
  role: "admin",
  isAdmin: true,
  staff: { role: "admin", can_access: true },
};
const POST_ID = "55555555-5555-4555-8555-555555555555";
const BROWSER =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
/** Valid bodies, so these routes get as far as a database command. */
const BODIES: Record<string, Record<string, unknown>> = {
  "POST engagement/like": { targetId: POST_ID, targetType: "listing", liked: true },
  "POST foundation/enquiries": {
    request_id: "66666666-6666-4666-8666-666666666666",
    post_id: POST_ID,
    buyer_email: "visitor@example.invalid",
    message: "Is this still available?",
    turnstile_token: "token",
  },
  "POST contact": {
    listingId: POST_ID,
    message: "Is this still available?",
    buyerEmail: "visitor@example.invalid",
    turnstileToken: "token",
  },
  "POST foundation/contact": { post_id: POST_ID, channel: "call", turnstile_token: "token" },
  "POST foundation/reports": {
    targetId: POST_ID,
    targetType: "listing",
    reason: "scam",
    description: "This asks for payment before viewing.",
    turnstileToken: "token",
  },
  "POST profile/update": { displayName: "Thando", bio: "Hello", expectedRevision: 1 },
  "POST otp/send": { phone: "0821234567" },
  "POST admin/content/decide": {
    itemId: POST_ID,
    area: "MZANSI_MARKET",
    contentType: "listing",
    decision: "approve",
    expectedRevision: 7,
    claimGeneration: "9",
    claimNonce: "33333333-3333-4333-8333-333333333333",
  },
  "POST admin/feature-flags/toggle": {
    key: "kyc_evidence_desk",
    enabled: true,
    expectedRevision: 1,
  },
  "POST admin/payments/ozow-refunds": {
    action: "refund.approve",
    requestId: "77777777-7777-4777-8777-777777777777",
  },
};
const METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
/** Routes outside this test: not called by signed-in pages with JSON. */
const OUTSIDE = new Set([
  // Server-to-server, covered by their own tests.
  "webhooks/ozow",
  "webhooks/ozow/refunds",
  "webhooks/ops-jobs",
  "internal/bindings/verify",
  "internal/payments/reconcile",
  "internal/payments/refunds/reconcile",
  "internal/retention/run",
  "csp-report",
  // Closed: answer 204 without reading the request.
  "analytics/visit",
  "engagement/share",
]);

type Handler = (request: NextRequest, context: unknown) => Promise<Response>;
const modules = import.meta.glob<Record<string, unknown>>("/src/app/api/**/route.ts");
let routes: Array<{ name: string; method: string; handler: Handler }> = [];

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", SITE);
  vi.stubEnv("FOUNDATION_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "native-captcha");
  vi.stubEnv("FOUNDATION_AUTH_CALLBACK_ENABLED", "true");
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  vi.stubEnv("FOUNDATION_PHONE_OTP_KEY", "0123456789abcdef".repeat(4));
  vi.stubGlobal("fetch", async () => {
    work.commands.push("network");
    throw new Error("no network in this test");
  });
  for (const [file, load] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const name = file.replace(/^\/src\/app\/api\//, "").replace(/\/route\.ts$/, "");
    if (OUTSIDE.has(name)) continue;
    const exports = await load();
    for (const method of METHODS)
      if (typeof exports[method] === "function")
        routes.push({ name, method, handler: exports[method] as Handler });
  }
}, 120_000);
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  routes = [];
});
beforeEach(() => {
  work.commands.length = 0;
  work.args.length = 0;
});

function send(route: (typeof routes)[number], body: string) {
  const request = new NextRequest(`${SITE}/api/${route.name.replace(/\[[^\]]+\]/g, ID)}`, {
    method: route.method,
    headers: {
      origin: SITE,
      "content-type": "application/json",
      cookie: `vm_csrf=${TOKEN}`,
      "x-csrf-token": TOKEN,
      "user-agent": BROWSER,
    },
    body,
  });
  const params = Promise.resolve({ id: ID, fileId: ID, key: ["file"], type: "listing" });
  return route.handler(request, { params });
}
describe("fields naming another account never reach a database command", () => {
  it("on any state-changing route", async () => {
    const leaks: string[] = [];
    const reached: string[] = [];
    for (const route of routes) {
      const key = `${route.method} ${route.name}`;
      work.args.length = 0;
      work.commands.length = 0;
      await Promise.race([
        send(route, JSON.stringify({ ...(BODIES[key] ?? {}), ...INJECTED })),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      for (const call of work.args)
        if (JSON.stringify(call.args ?? null).includes(OTHER)) leaks.push(`${key}: ${call.name}`);
      if (work.commands.length > 0) reached.push(key);
    }
    expect(leaks).toEqual([]);
    // The check means something only if requests reached commands.
    expect(reached).toEqual(expect.arrayContaining(["POST engagement/like"]));
  });

  it("a signed-in like is the session's account, whatever the body says", async () => {
    const like = routes.find((route) => route.name === "engagement/like")!;
    await send(like, JSON.stringify({ ...BODIES["POST engagement/like"], ...INJECTED }));
    const call = work.args.find((entry) => entry.name === "set_post_like");
    expect(call?.args).toMatchObject({ p_account: "22222222-2222-4222-8222-222222222222" });
  });

  it("bodies that reach a command as sent are refused with the extra fields, or the fields are ignored", async () => {
    const reached: string[] = [];
    const accepted: string[] = [];
    for (const [key, body] of Object.entries(BODIES)) {
      const route = routes.find((r) => `${r.method} ${r.name}` === key)!;
      work.commands.length = 0;
      await send(route, JSON.stringify(body));
      if (work.commands.length === 0) continue;
      reached.push(key);
      work.commands.length = 0;
      const response = await send(route, JSON.stringify({ ...body, ...INJECTED }));
      if (response.status < 400 || work.commands.length > 0) accepted.push(key);
    }
    // Other routes need more than this test supplies (a post lookup, a dashboard read).
    expect(reached).toEqual([
      "POST engagement/like",
      "POST foundation/contact",
      "POST profile/update",
      "POST otp/send",
      "POST admin/content/decide",
      "POST admin/feature-flags/toggle",
    ]);
    // Only the like route accepts (and ignores) unknown fields.
    expect(accepted).toEqual(["POST engagement/like"]);
  });
});
