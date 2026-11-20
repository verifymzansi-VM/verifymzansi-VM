/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every state-changing API route (POST, PUT, PATCH, DELETE under src/app/api)
 * is called with requests a browser sends for another website, or without the
 * double-submit token, and must refuse them with 403 before it reads a
 * session, spends a rate-limit allowance, creates a database client or makes
 * a network request. The route list is read from the file system, so a new
 * route is covered as soon as it exists; one that is meant to work without
 * the token must be named below with what protects it instead.
 *
 * The mutation guard (src/lib/utils/mutation-guard.ts) and its origin and token
 * checks run for real. Only the boundaries behind them are replaced, by spies
 * that record any call.
 */

const touched = vi.hoisted(() => ({ calls: [] as string[] }));
const touch = (name: string) => touched.calls.push(name);

// Every hidden feature on, so a route hidden at launch is still checked.
vi.mock("@/lib/hidden-features", async (original) => {
  const real = await original<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([key, value]) => [key, typeof value === "boolean" ? true : value])
  );
});
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => {
    touch("connection");
    return {};
  },
}));
vi.mock("@/lib/foundation/request-route", () => ({
  createFoundationRouteContext: () => {
    touch("session");
    const refuse = async () => {
      touch("session");
      throw new Error("no session in this test");
    };
    return { authenticate: refuse, authenticateCaller: refuse, respond: async (r: unknown) => r };
  },
}));
vi.mock("@/lib/foundation/service-api", () => ({
  createFoundationServiceApi: () => {
    touch("service");
    return {
      rpc: async () => {
        throw new Error("no database in this test");
      },
    };
  },
}));
vi.mock("@/lib/utils/rate-limit", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  checkRateLimit: async () => {
    touch("rate-limit");
    return { limited: false };
  },
  checkSensitiveActionRateLimit: async () => {
    touch("rate-limit");
    return { limited: false };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    touch("retired-admin");
    throw new Error("retired backend");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    touch("retired-server");
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
const TOKEN = "a1".repeat(32);
const OTHER_TOKEN = "b2".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const GUARD_ERRORS = new Set([
  "Invalid CSRF token",
  "Cross-site requests are not allowed",
  "Invalid request origin",
  "Unable to resolve application origin",
]);
const METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** Routes that are not called by this website's pages, and what they rely on
 * instead of the browser checks. They must still refuse a caller without it. */
const SERVER_TO_SERVER: Record<string, string> = {
  "webhooks/ozow": "provider signature",
  "webhooks/ozow/refunds": "provider signature",
  "webhooks/ops-jobs": "shared job secret",
  "internal/bindings/verify": "shared job secret",
  "internal/payments/reconcile": "shared job secret",
  "internal/payments/refunds/reconcile": "shared job secret",
  "internal/retention/run": "shared job secret",
  "csp-report": "browser report, stored only in logs",
};
/** Closed routes: pages still call them, and they answer 204 without reading
 * the request, calling a database or setting a cookie. */
const CLOSED = ["analytics/events", "analytics/visit", "engagement/share"];
/** Routes a signed-out visitor's page calls without the token; the origin
 * check still applies (with a Turnstile check or a signed browser identifier
 * behind it). */
const ORIGIN_ONLY: Record<string, string> = {
  "contact/general": "Turnstile",
  "engagement/view": "signed browser identifier",
};

type Handler = (request: NextRequest, context: unknown) => Promise<Response>;
const modules = import.meta.glob<Record<string, unknown>>("/src/app/api/**/route.ts");
const routeName = (file: string) =>
  file.replace(/^\/src\/app\/api\//, "").replace(/\/route\.ts$/, "");

let routes: Array<{ name: string; method: string; handler: Handler }> = [];

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", SITE);
  // Routes behind a launch switch answer 503 before their checks while it is off.
  vi.stubEnv("FOUNDATION_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "native-captcha");
  vi.stubEnv("FOUNDATION_AUTH_CALLBACK_ENABLED", "true");
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  // Paused add-on sales answer before any check; open them so the checks run.
  vi.stubEnv("ADDON_SALES_ENABLED", "true");
  vi.stubGlobal("fetch", async () => {
    touch("network");
    throw new Error("no network in this test");
  });
  for (const [file, load] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const exports = await load();
    for (const method of METHODS)
      if (typeof exports[method] === "function")
        routes.push({ name: routeName(file), method, handler: exports[method] as Handler });
  }
}, 120_000);
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  routes = [];
});
beforeEach(() => {
  touched.calls.length = 0;
});

function send(
  route: { name: string; method: string; handler: Handler },
  headers: Record<string, string>
) {
  const request = new NextRequest(`${SITE}/api/${route.name.replace(/\[[^\]]+\]/g, ID)}`, {
    method: route.method,
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
  const params = Promise.resolve({ id: ID, fileId: ID, key: ["file"], type: "listing" });
  return route.handler(request, { params });
}
const tokenPair = (cookie: string, header: string) => ({
  cookie: `vm_csrf=${cookie}`,
  "x-csrf-token": header,
});

/** Requests from another website, each carrying a valid token pair so only
 * the origin check can refuse them. */
const crossSite: Array<[string, Record<string, string>]> = [
  ["another website's origin", { origin: "https://other-site.example" }],
  ["a look-alike host", { origin: "https://verifymzansi.com.other-site.example" }],
  ["the site's name over plain http", { origin: "http://verifymzansi.com" }],
  ["an opaque (null) origin", { origin: "null" }],
  ["cross-site fetch metadata", { "sec-fetch-site": "cross-site" }],
  ["a typed-in navigation", { "sec-fetch-site": "none" }],
].map(([label, headers]) => [
  label as string,
  { ...(headers as Record<string, string>), ...tokenPair(TOKEN, TOKEN) },
]);
/** Same-origin requests without a usable token pair. */
const badToken: Array<[string, Record<string, string>]> = [
  ["no token at all", {}],
  ["the cookie without the header", { cookie: `vm_csrf=${TOKEN}` }],
  ["the header without the cookie", { "x-csrf-token": TOKEN }],
  ["a header that does not match the cookie", tokenPair(TOKEN, OTHER_TOKEN)],
  ["a short matching pair", tokenPair("abc123", "abc123")],
  ["a matching pair that is not hexadecimal", tokenPair("z".repeat(64), "z".repeat(64))],
  ["the same token in different letter case", tokenPair(TOKEN, TOKEN.toUpperCase())],
].map(([label, headers]) => [label as string, { origin: SITE, ...(headers as object) }]);

const exempt = (route: { name: string }) =>
  route.name in SERVER_TO_SERVER || CLOSED.includes(route.name);
const browserRoutes = () =>
  routes.filter((route) => !exempt(route) && !(route.name in ORIGIN_ONLY));

describe("the route list", () => {
  it("finds the state-changing routes and every named exception exists", () => {
    expect(routes.length).toBeGreaterThan(100);
    const names = new Set(routes.map((route) => route.name));
    for (const name of [...Object.keys(SERVER_TO_SERVER), ...Object.keys(ORIGIN_ONLY), ...CLOSED])
      expect(names, name).toContain(name);
  });
});

describe("requests from another website are refused before any work", () => {
  it.each(crossSite)("%s", async (_label, headers) => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => !exempt(r))) {
      touched.calls.length = 0;
      const response = await send(route, headers);
      if (response.status !== 403 || touched.calls.length > 0)
        failures.push(`${route.method} ${route.name}: ${response.status} [${touched.calls}]`);
    }
    expect(failures).toEqual([]);
  });
});

describe("same-origin writes without a valid token pair are refused before any work", () => {
  it.each(badToken)("%s", async (_label, headers) => {
    const failures: string[] = [];
    for (const route of browserRoutes()) {
      touched.calls.length = 0;
      const response = await send(route, headers);
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (
        response.status !== 403 ||
        body.error !== "Invalid CSRF token" ||
        touched.calls.length > 0
      )
        failures.push(`${route.method} ${route.name}: ${response.status} [${touched.calls}]`);
    }
    expect(failures).toEqual([]);
  });
});

describe("a same-origin write with a valid token pair gets past the browser checks", () => {
  // Without this the refusals above could pass for a route that refuses everything.
  it("on every route the checks above apply to", async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => !exempt(r))) {
      const response = await send(route, { origin: SITE, ...tokenPair(TOKEN, TOKEN) });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (GUARD_ERRORS.has(body.error ?? ""))
        failures.push(`${route.method} ${route.name}: ${body.error}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("server-to-server routes refuse a caller without their credential", () => {
  it.each(Object.entries(SERVER_TO_SERVER))("%s (%s)", async (name) => {
    for (const route of routes.filter((r) => r.name === name)) {
      touched.calls.length = 0;
      const response = await send(route, { origin: SITE });
      expect(response.status, `${route.method} ${name}`).toBeGreaterThanOrEqual(400);
      expect(touched.calls.filter((call) => call !== "rate-limit")).toEqual([]);
    }
  });
});

describe("closed routes do nothing for anyone", () => {
  it.each(CLOSED)("%s", async (name) => {
    for (const route of routes.filter((r) => r.name === name)) {
      touched.calls.length = 0;
      const response = await send(route, { origin: "https://other-site.example" });
      expect(response.status).toBe(204);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(touched.calls).toEqual([]);
    }
  });
});
