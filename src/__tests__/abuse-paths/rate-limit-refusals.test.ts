/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every state-changing API route called by a signed-in member, from this site
 * with a valid token pair, while the shared rate limiter refuses every request
 * (and, separately, while it cannot be reached). The real limiter client runs
 * (src/lib/utils/rate-limit.ts) against a stand-in for the limiter service. No
 * route may run a database command; the high-risk routes listed below must
 * answer 429 with Retry-After, or 503 when the limiter is down and they are
 * meant to fail closed. The route list is read from the file system, as in
 * mutation-route-refusals.test.ts.
 */

const work = vi.hoisted(() => ({ commands: [] as string[] }));
vi.mock("@/lib/hidden-features", async (original) => {
  const real = await original<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([key, value]) => [key, typeof value === "boolean" ? true : value])
  );
});
const rpc = vi.hoisted(() => async (name: string) => {
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
const LIMITER = "https://limiter.invalid/check";
/** The limiter service's answer to every check. */
let limiter: () => Response = () => Response.json({ ok: true });
const TOKEN = "d4".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
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
  vi.stubEnv("OTP_RATE_LIMITER_URL", LIMITER);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input) === LIMITER) return limiter();
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
  limiter = () => Response.json({ ok: true });
});

function send(route: (typeof routes)[number], body: string) {
  const request = new NextRequest(`${SITE}/api/${route.name.replace(/\[[^\]]+\]/g, ID)}`, {
    method: route.method,
    headers: {
      origin: SITE,
      "content-type": "application/json",
      cookie: `vm_csrf=${TOKEN}`,
      "x-csrf-token": TOKEN,
      "user-agent":
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
    },
    body,
  });
  const params = Promise.resolve({ id: ID, fileId: ID, key: ["file"], type: "listing" });
  return route.handler(request, { params });
}
/** A body each high-risk route accepts as far as its limit check. */
const POST_ID = "55555555-5555-4555-8555-555555555555";
const BODIES: Record<string, unknown> = {
  // /api/reports is the restored page's name for /api/foundation/reports.
  "POST reports": {
    targetId: POST_ID,
    targetType: "listing",
    reason: "scam",
    description: "This asks for payment before viewing.",
    turnstileToken: "token",
  },
  "POST engagement/like": { targetId: POST_ID, targetType: "listing", liked: true },
  "POST foundation/contact": { post_id: POST_ID, channel: "call", turnstile_token: "token" },
  "POST foundation/enquiries": {
    request_id: "66666666-6666-4666-8666-666666666666",
    post_id: POST_ID,
    buyer_email: "visitor@example.invalid",
    message: "Is this still available?",
    turnstile_token: "token",
  },
  "POST foundation/reports": {
    targetId: POST_ID,
    targetType: "listing",
    reason: "scam",
    description: "This asks for payment before viewing.",
    turnstileToken: "token",
  },
  "POST contact": {
    listingId: POST_ID,
    message: "Is this still available?",
    buyerEmail: "visitor@example.invalid",
    turnstileToken: "token",
  },
  "POST contact/general": {
    name: "Thando",
    email: "visitor@example.invalid",
    message: "A question about my account.",
    turnstileToken: "token",
  },
};
/** High-risk routes that must answer 429 with Retry-After while limited. */
const LIMITED = [
  "POST profile/update",
  "POST appeals",
  "PATCH notifications",
  "POST otp/send",
  "POST otp/verify",
  "POST foundation/enquiries",
  "PATCH foundation/enquiries",
  "POST foundation/contact",
  "POST contact",
  "POST contact/general",
  "POST engagement/like",
  "POST listings",
  "POST promotions",
  "POST businesses",
  "POST reports",
  "POST foundation/reports",
  "POST account/delete",
  "POST dsar/submit",
  "POST billing/create-checkout",
  "POST admin/content/decide",
  "POST admin/governance/roles",
  "POST admin/payments/ozow-refunds",
  "POST admin/dsar/export",
];
/** Of those, the ones that answer 429 without a Retry-After header. */
const NO_RETRY_AFTER = new Set([
  "POST foundation/contact",
  "POST reports",
  "POST foundation/reports",
]);
/** Routes that keep counting with the per-instance limiter while the shared
 * one cannot be reached (by design: a like or a support message is low risk). */
const LOCAL_FALLBACK = new Set(["POST engagement/like", "POST contact/general"]);
const FAIL_CLOSED = LIMITED.filter((route) => !LOCAL_FALLBACK.has(route));

async function sweep(allowLocalFallback = false) {
  const answers = new Map<string, { status: number; retryAfter: string | null }>();
  const failures: string[] = [];
  for (const route of routes) {
    const key = `${route.method} ${route.name}`;
    work.commands.length = 0;
    const response = await send(route, JSON.stringify(BODIES[key] ?? {}));
    answers.set(key, { status: response.status, retryAfter: response.headers.get("retry-after") });
    // The page-view beacon answers 200 whatever happens; it must still count nothing.
    if (allowLocalFallback && LOCAL_FALLBACK.has(key)) continue;
    if ((response.status < 400 && route.name !== "engagement/view") || work.commands.length > 0)
      failures.push(`${key}: ${response.status} [${work.commands}]`);
  }
  return { answers, failures };
}

describe("while the shared limiter refuses every request", () => {
  it("no route runs a command, and the high-risk routes answer 429 with Retry-After", async () => {
    limiter = () => Response.json({ retryAfter: 120 }, { status: 429 });
    const { answers, failures } = await sweep();
    expect(failures).toEqual([]);
    const wrong = LIMITED.filter((key) => {
      const answer = answers.get(key);
      return (
        answer?.status !== 429 ||
        (!NO_RETRY_AFTER.has(key) && !/^[1-9][0-9]*$/.test(answer.retryAfter ?? ""))
      );
    }).map((key) => `${key}: ${JSON.stringify(answers.get(key))}`);
    expect(wrong).toEqual([]);
  });
});

describe("while the shared limiter cannot be reached", () => {
  it("no route runs a command, and the fail-closed routes answer 503", async () => {
    limiter = () => {
      throw new TypeError("limiter unreachable");
    };
    const { answers, failures } = await sweep(true);
    expect(failures).toEqual([]);
    const wrong = FAIL_CLOSED.filter((key) => answers.get(key)?.status !== 503).map(
      (key) => `${key}: ${answers.get(key)?.status}`
    );
    expect(wrong).toEqual([]);
  });

  it("an error answer from the limiter counts as unreachable, never as allowed", async () => {
    limiter = () => new Response("bad gateway", { status: 502 });
    const { answers, failures } = await sweep(true);
    expect(failures).toEqual([]);
    expect(FAIL_CLOSED.filter((key) => answers.get(key)?.status !== 503)).toEqual([]);
  });
});
