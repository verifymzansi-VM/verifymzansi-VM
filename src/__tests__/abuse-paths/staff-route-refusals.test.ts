/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Staff routes (src/app/api/admin and src/app/api/foundation/staff) called by
 * a signed-in member from this site with a valid token pair, where the
 * database refuses the caller: either not staff, or staff whose second factor
 * is not fresh enough. Staff authority lives in the database's api.* commands,
 * so the routes must pass that refusal on as 403 (with the step-up code for a
 * second-factor refusal), never as success, and never echo the database's own
 * message. The route list is read from the file system.
 */

vi.mock("@/lib/hidden-features", async (original) => {
  const real = await original<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([key, value]) => [key, typeof value === "boolean" ? true : value])
  );
});
const database = vi.hoisted(() => ({
  /** The refusal message, or null for a staff session the database accepts. */
  message: "permission denied: staff role required" as string | null,
  calls: [] as string[],
}));
const rpc = vi.hoisted(() => async (name: string) => {
  database.calls.push(name);
  if (database.message === null) return { data: {}, error: null };
  return { data: null, error: { code: "42501", message: database.message, details: null } };
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
vi.mock("@/lib/foundation/service-api", () => ({
  createFoundationServiceApi: () => {
    database.calls.push("service");
    return { rpc };
  },
}));
vi.mock("@/lib/utils/rate-limit", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  checkRateLimit: async () => ({ limited: false }),
  checkSensitiveActionRateLimit: async () => ({ limited: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("retired backend");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
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
const TOKEN = "e5".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const NOT_STAFF = "permission denied: staff role required";
const SECOND_FACTOR = "recent second-factor verification required";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Bodies each of these routes accepts as far as the database command. */
const BODIES: Record<string, unknown> = {
  "POST admin/content/decide": {
    itemId: ID,
    area: "MZANSI_MARKET",
    contentType: "listing",
    decision: "approve",
    expectedRevision: 7,
    claimGeneration: "9",
    claimNonce: "33333333-3333-4333-8333-333333333333",
  },
  "POST admin/dsar/intake": {
    type: "access",
    requesterEmail: "requester@example.invalid",
    description: "Please send me a copy of my data.",
    intakeNote: "Arrived by post.",
  },
  "POST admin/feature-flags/toggle": {
    key: "kyc_evidence_desk",
    enabled: true,
    expectedRevision: 1,
  },
  "POST admin/payments/ozow-refunds": { action: "refund.approve", requestId: ID },
};
/** Routes that must answer exactly 403 for these refusals. */
const EXACT = Object.keys(BODIES);

type Handler = (request: NextRequest, context: unknown) => Promise<Response>;
const modules = import.meta.glob<Record<string, unknown>>([
  "/src/app/api/admin/**/route.ts",
  "/src/app/api/foundation/staff/**/route.ts",
]);
let routes: Array<{ name: string; method: string; handler: Handler }> = [];

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", SITE);
  vi.stubGlobal("fetch", async () => {
    throw new Error("no network in this test");
  });
  for (const [file, load] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const name = file.replace(/^\/src\/app\/api\//, "").replace(/\/route\.ts$/, "");
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
  database.calls.length = 0;
});

function send(route: (typeof routes)[number]) {
  const key = `${route.method} ${route.name}`;
  const path = `${SITE}/api/${route.name.replace(/\[[^\]]+\]/g, ID)}`;
  const request = new NextRequest(route.method === "GET" ? `${path}?id=${ID}` : path, {
    method: route.method,
    headers: {
      origin: SITE,
      "content-type": "application/json",
      cookie: `vm_csrf=${TOKEN}`,
      "x-csrf-token": TOKEN,
    },
    ...(route.method === "GET" ? {} : { body: JSON.stringify(BODIES[key] ?? {}) }),
  });
  const params = Promise.resolve({ id: ID, fileId: ID });
  return route.handler(request, { params });
}

type Answer = { status: number; body: Record<string, unknown>; asked: boolean };

async function sweep(message: string | null) {
  database.message = message;
  const answers = new Map<string, Answer>();
  const failures: string[] = [];
  for (const route of routes) {
    const key = `${route.method} ${route.name}`;
    database.calls.length = 0;
    const response = await send(route);
    const asked = database.calls.length > 0;
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Binary or empty answers carry no message to check.
    }
    answers.set(key, { status: response.status, body, asked });
    if (response.status < 400) failures.push(`${key}: ${response.status}`);
    if (message && text.includes(message)) failures.push(`${key}: repeats the database message`);
  }
  return { answers, failures };
}

describe("staff routes and a caller the database does not accept", () => {
  it("finds the staff routes and every route with a body", () => {
    expect(routes.length).toBeGreaterThan(30);
    const found = new Set(routes.map((route) => `${route.method} ${route.name}`));
    for (const key of EXACT) expect(found, key).toContain(key);
  });

  it("a member who is not staff gets no success and no database detail", async () => {
    const { answers, failures } = await sweep(NOT_STAFF);
    expect(failures).toEqual([]);
    // The routes with bodies reached the database's staff check (a 400 for the
    // body would also be "no success" and prove nothing), and refused with 403.
    const wrong = EXACT.filter((key) => {
      const answer = answers.get(key);
      return !answer?.asked || answer.status !== 403;
    }).map((key) => `${key}: ${JSON.stringify(answers.get(key))}`);
    expect(wrong).toEqual([]);
    // Any other route that asked the database passes its refusal on as 403 too.
    const others = [...answers]
      .filter(([, answer]) => answer.asked && answer.status !== 403)
      .map(([key, answer]) => `${key}: ${answer.status}`);
    expect(others).toEqual([]);
  });

  it("a staff session the database accepts gets past the routes' own checks", async () => {
    // The positive control: a route that refused everyone, or refused these
    // bodies before asking the database, would pass the sweeps above.
    const { answers } = await sweep(null);
    const wrong = EXACT.filter((key) => {
      const answer = answers.get(key);
      return !answer?.asked || [400, 401, 403].includes(answer.status);
    }).map((key) => `${key}: ${JSON.stringify(answers.get(key))}`);
    expect(wrong).toEqual([]);
  });

  it("staff without a fresh second factor get no success and are sent to confirm it", async () => {
    const { answers, failures } = await sweep(SECOND_FACTOR);
    expect(failures).toEqual([]);
    const wrong = EXACT.filter((key) => {
      const answer = answers.get(key);
      return !answer?.asked || answer.status !== 403 || answer.body.code !== "step_up_required";
    }).map((key) => `${key}: ${JSON.stringify(answers.get(key))}`);
    expect(wrong).toEqual([]);
  });
});
