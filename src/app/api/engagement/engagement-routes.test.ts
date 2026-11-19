/** @vitest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The view and like routes with SHOW_ENGAGEMENT_TOTALS on (as at launch),
// through the real signed-cookie code, with a real browser user agent. The
// database is a small in-memory stand-in that keeps the rules the routes rely
// on (one view per browser and post, one like per browser); the SQL rules
// themselves are proven by scripts/test-foundation-post-views-and-likes.mjs.
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  origin: vi.fn(),
  rate: vi.fn(),
  account: vi.fn(),
}));
vi.mock("@/lib/hidden-features", () => ({ SHOW_ENGAGEMENT_TOTALS: true }));
vi.mock("@/lib/utils/mutation-guard", () => ({ enforceMutationRequest: mocks.guard }));
vi.mock("@/lib/utils/mutation-origin", () => ({ enforceSameOriginMutation: mocks.origin }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mocks.rate,
  getClientRateLimitIdentity: (request: Request) => {
    const ip = request.headers.get("cf-connecting-ip") ?? "203.0.113.7";
    return { key: ip, ip, source: "cf-connecting-ip" };
  },
}));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/request-route", () => ({
  createFoundationRouteContext: () => ({
    authenticateCaller: mocks.account,
    respond: async (response: NextResponse) => response,
  }),
}));

/** The database stand-in. */
const db = vi.hoisted(() => {
  const state = {
    seen: new Set<string>(),
    views: new Map<string, number>(),
    likes: new Map<string, Set<string>>(),
    calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    if (name === "record_post_views") {
      const counted: string[] = [];
      for (const post of args.p_post_ids as string[]) {
        const key = `${args.p_device}|${post}`;
        if (state.seen.has(key)) continue;
        state.seen.add(key);
        state.views.set(post, (state.views.get(post) ?? 0) + 1);
        counted.push(post);
      }
      return { data: { counted }, error: null };
    }
    const post = args.p_post_id as string;
    const liker = (args.p_account as string | undefined) ?? `device:${args.p_device}`;
    const likers = state.likes.get(post) ?? new Set<string>();
    state.likes.set(post, likers);
    const wanted = (args.p_liked as boolean | undefined) ?? !likers.has(liker);
    if (wanted) likers.add(liker);
    else likers.delete(liker);
    return { data: { liked: wanted, likes: likers.size, counted: true }, error: null };
  });
  return { state, rpc };
});
vi.mock("@/lib/foundation/service-api", () => ({
  createFoundationServiceApi: () => ({ rpc: db.rpc }),
}));

import { POST as postView } from "./view/route";
import { POST as postLike } from "./like/route";
import { issueViewerToken } from "@/lib/engagement-cookie";

const POST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const OTHER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-000000000001";
const BROWSER =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const SECRET = "synthetic-engagement-cookie-secret-for-unit-tests-only";

function request(
  path: string,
  body: unknown,
  { cookie, headers = {} }: { cookie?: string | null; headers?: Record<string, string> } = {}
) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": BROWSER,
      ...(cookie ? { cookie: `vmz_viewer=${cookie}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const pageView = (id = POST_ID) => ({ type: "business", id, source: "page", surface: "detail" });
const view = (cookie: string | null, events: object[] = [pageView()], headers = {}) =>
  postView(request("/api/engagement/view", { events }, { cookie, headers }));
const like = (cookie: string | null, body: object, headers = {}) =>
  postLike(request("/api/engagement/like", body, { cookie, headers }));
/** The cookie value a response set, or null. */
const issued = (response: Response) =>
  /vmz_viewer=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1] ?? null;

beforeAll(() => {
  vi.stubEnv("ENGAGEMENT_COOKIE_SECRET", SECRET);
});
afterAll(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  mocks.guard.mockReset().mockReturnValue(null);
  mocks.origin.mockReset().mockReturnValue(null);
  mocks.rate.mockReset().mockResolvedValue({ limited: false });
  mocks.account.mockReset().mockRejectedValue(new Error("signed out"));
  db.rpc.mockClear();
  db.state.seen.clear();
  db.state.views.clear();
  db.state.likes.clear();
  db.state.calls.length = 0;
});

describe("views through the route", () => {
  it("a real browser: issued a signed cookie, sends again, counted once a day", async () => {
    const first = await view(null);
    expect(await first.json()).toEqual({ ok: true, counted: [], retry: true });
    const cookie = issued(first);
    expect(cookie).toMatch(/^v1\.[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(first.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(db.rpc).not.toHaveBeenCalled();

    expect(await (await view(cookie)).json()).toEqual({ ok: true, counted: [POST_ID] });
    expect(await (await view(cookie)).json()).toEqual({ ok: true, counted: [] });
    expect(db.state.views.get(POST_ID)).toBe(1);
    // The database gets the bare identifier, never the signed cookie.
    expect(db.state.calls[0]!.args.p_device).toBe(cookie!.split(".")[1]);
  });

  it("a made-up identifier is never counted: neither a bare UUID nor a forged signature", async () => {
    const token = (await issueViewerToken())!;
    for (const forged of [
      crypto.randomUUID(),
      `v1.${crypto.randomUUID()}.${Math.floor(Date.now() / 1000)}.${token.value.split(".")[3]}`,
      `${token.value.slice(0, -2)}AA`,
      `v1.${token.id}.${Math.floor(Date.now() / 1000) + 3600}.${token.value.split(".")[3]}`,
    ]) {
      const response = await view(forged);
      expect(await response.json()).toMatchObject({ counted: [] });
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("an expired identifier is not accepted", async () => {
    const old = (await issueViewerToken(Date.now() - 500 * 24 * 3600 * 1000))!;
    expect(await (await view(old.value)).json()).toMatchObject({ counted: [], retry: true });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("a script minting browsers is held to the issuing limit, per address and per IPv6 /64", async () => {
    mocks.rate.mockImplementation(async ({ action }: { action: string }) => ({
      limited: action === "engagement:viewer",
    }));
    const response = await view(null, [pageView()], { "cf-connecting-ip": "2001:db8:1:2:aaaa::1" });
    expect(await response.json()).toEqual({ ok: true, counted: [] });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.rate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "engagement:viewer", key: "v6:2001:db8:1:2::/64" })
    );
    await view(null, [pageView()], { "cf-connecting-ip": "2001:0db8:0001:0002:ffff::9" });
    expect(mocks.rate).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "v6:2001:db8:1:2::/64" })
    );
    await view(null, [pageView()], { "cf-connecting-ip": "::ffff:198.51.100.4" });
    expect(mocks.rate).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: "v4:198.51.100.4" })
    );
  });

  it("counts at most three page views per request, each within the per-post limit", async () => {
    const cookie = (await issueViewerToken())!.value;
    const ids = Array.from({ length: 6 }, (_, n) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000001${n}`);
    mocks.rate.mockImplementation(async ({ key }: { key: string }) => ({
      limited: key.endsWith(ids[1]!),
    }));
    const response = await view(
      cookie,
      ids.map((id) => pageView(id))
    );
    expect((await response.json()).counted).toEqual([ids[0], ids[2]]);
    expect(mocks.rate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "engagement:view:post", key: `v4:203.0.113.7|${ids[0]}` })
    );
  });

  it.each([
    ["a crawler", { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }],
    ["a headless browser", { "user-agent": "Mozilla/5.0 HeadlessChrome/130.0" }],
    ["a prefetch", { "sec-purpose": "prefetch" }],
    ["a router prefetch", { "next-router-prefetch": "1" }],
  ])("%s is never counted and gets no cookie", async (_label, headers) => {
    const response = await view(null, [pageView()], headers);
    expect(await response.json()).toEqual({ ok: true, counted: [] });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("without the signing secret nothing is issued or counted", async () => {
    const cookie = (await issueViewerToken())!.value;
    vi.stubEnv("ENGAGEMENT_COOKIE_SECRET", "");
    try {
      const response = await view(cookie);
      expect(await response.json()).toEqual({ ok: true, counted: [] });
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(db.rpc).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("ENGAGEMENT_COOKIE_SECRET", SECRET);
    }
  });

  it("refuses a bad payload, and answers 503 when the database fails", async () => {
    const cookie = (await issueViewerToken())!.value;
    expect((await view(cookie, [])).status).toBe(400);
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } } as never);
    expect((await view(cookie)).status).toBe(503);
  });
});

describe("likes through the route", () => {
  it("a signed-out like persists across requests and toggles off", async () => {
    const first = await like(null, { targetId: POST_ID, targetType: "listing", liked: true });
    expect(await first.json()).toEqual({ liked: true, likeCount: 1, counted: true });
    const cookie = issued(first)!;
    expect(cookie).toMatch(/^v1\./);
    // Same browser: still liked, no second like.
    expect(
      await (await like(cookie, { targetId: POST_ID, targetType: "listing", liked: true })).json()
    ).toEqual({ liked: true, likeCount: 1, counted: true });
    // Another browser adds one; the first unlikes.
    await like(null, { targetId: POST_ID, targetType: "listing", liked: true });
    expect(await (await like(cookie, { targetId: POST_ID, targetType: "listing" })).json()).toEqual(
      { liked: false, likeCount: 1, counted: true }
    );
  });

  it("signed in, the like is the account's", async () => {
    mocks.account.mockResolvedValue({ accountId: ACCOUNT });
    const cookie = (await issueViewerToken())!.value;
    await like(cookie, { targetId: OTHER_ID, targetType: "listing", liked: true });
    expect(db.state.calls.at(-1)!.args).toMatchObject({ p_account: ACCOUNT, p_liked: true });
  });

  it("a forged cookie gets a new signed identifier within the issuing limit, or 429", async () => {
    const forged = crypto.randomUUID();
    const response = await like(forged, { targetId: POST_ID, targetType: "listing" });
    expect(issued(response)).toMatch(/^v1\./);
    expect(db.state.calls.at(-1)!.args.p_device).not.toBe(forged);
    mocks.rate.mockImplementation(async ({ action }: { action: string }) => ({
      limited: action === "engagement:viewer",
    }));
    expect((await like(forged, { targetId: POST_ID, targetType: "listing" })).status).toBe(429);
  });

  it("maps refusals: hidden post 404, per-post limit 429, failure 503", async () => {
    const cookie = (await issueViewerToken())!.value;
    const body = { targetId: POST_ID, targetType: "listing" };
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } } as never);
    expect((await like(cookie, body)).status).toBe(404);
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT429" } } as never);
    expect((await like(cookie, body)).status).toBe(429);
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } } as never);
    expect((await like(cookie, body)).status).toBe(503);
  });

  it("refuses a crawler, a request over the limit, a bad body, a failed CSRF check and a missing secret", async () => {
    const cookie = (await issueViewerToken())!.value;
    const body = { targetId: POST_ID, targetType: "listing" };
    expect((await like(cookie, body, { "user-agent": "curl/8.0" })).status).toBe(403);
    mocks.rate.mockResolvedValueOnce({ limited: true, retryAfter: 30 });
    expect((await like(cookie, body)).status).toBe(429);
    expect((await like(cookie, { targetId: "x", targetType: "listing" })).status).toBe(400);
    mocks.guard.mockReturnValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await like(cookie, body)).status).toBe(403);
    vi.stubEnv("ENGAGEMENT_COOKIE_SECRET", "too-short");
    try {
      expect((await like(cookie, body)).status).toBe(503);
    } finally {
      vi.stubEnv("ENGAGEMENT_COOKIE_SECRET", SECRET);
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
