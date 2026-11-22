/** @vitest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The view, like and identifier routes with SHOW_ENGAGEMENT_TOTALS on (as at
// launch), through the real signed-cookie code, with a real browser user
// agent. The database is a small in-memory stand-in that keeps the rules the
// routes rely on (one view per browser and post, one like per liker); the SQL
// rules themselves are proven by scripts/test-foundation-post-views-and-likes.mjs.
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  origin: vi.fn(),
  rate: vi.fn(),
  account: vi.fn(),
  captcha: vi.fn(),
}));
vi.mock("@/lib/hidden-features", () => ({ SHOW_ENGAGEMENT_TOTALS: true }));
vi.mock("@/lib/utils/mutation-guard", () => ({ enforceMutationRequest: mocks.guard }));
vi.mock("@/lib/utils/mutation-origin", () => ({ enforceSameOriginMutation: mocks.origin }));
vi.mock("@/lib/utils/public-mutation-route", () => ({ verifyPublicTurnstile: mocks.captcha }));
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
    activity: [] as Array<[string, string]>,
    engaged: new Set<string>(),
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
    if (name === "record_post_activity") {
      const posts = args.p_post_ids as string[];
      const metrics = args.p_metrics as string[];
      let engaged = 0;
      posts.forEach((post, n) => {
        // A showroom appearance counts once per browser, post and showroom
        // (a day), and never without a browser.
        if (metrics[n]!.startsWith("showroom_")) {
          const key = `showroom|${args.p_device}|${post}|${metrics[n]}`;
          if (!args.p_device || state.seen.has(key)) return;
          state.seen.add(key);
          return state.activity.push([post, metrics[n]!]);
        }
        if (metrics[n] !== "engaged_views") return state.activity.push([post, metrics[n]!]);
        // Counted once per browser, and only after its view was counted.
        const key = `${args.p_device}|${post}`;
        if (state.seen.has(key) && !state.engaged.has(key)) {
          state.engaged.add(key);
          engaged++;
        }
      });
      return {
        data: { posts: new Set(state.activity.map(([post]) => post)).size, engaged },
        error: null,
      };
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
import { POST as postViewer } from "./viewer/route";
import { POST as postEvents } from "../analytics/events/route";
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
const challenge = (cookie: string | null = null, headers = {}) =>
  postViewer(request("/api/engagement/viewer", { turnstile_token: "token" }, { cookie, headers }));
/** The cookie value a response set, or null. */
const issued = (response: Response) =>
  /vmz_viewer=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1] ?? null;
const minutesAgo = async (minutes: number) =>
  (await issueViewerToken(Date.now() - minutes * 60_000))!.value;

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
  mocks.captcha.mockReset().mockResolvedValue(null);
  db.rpc.mockClear();
  db.state.seen.clear();
  db.state.views.clear();
  db.state.likes.clear();
  db.state.activity.length = 0;
  db.state.engaged.clear();
  db.state.calls.length = 0;
});

describe("the identifier route", () => {
  it("issues a signed identifier only after the Turnstile check", async () => {
    const response = await challenge();
    expect(await response.json()).toEqual({ ok: true });
    expect(issued(response)).toMatch(/^v1\.[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(mocks.captcha).toHaveBeenCalledWith(expect.anything(), "token", expect.anything(), {
      action: "engagement_viewer",
    });
  });

  it("a failed or unavailable Turnstile check issues nothing (fail closed for issuing)", async () => {
    mocks.captcha.mockResolvedValueOnce(
      NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 })
    );
    const failed = await challenge();
    expect(failed.status).toBe(400);
    expect(issued(failed)).toBeNull();
    mocks.captcha.mockResolvedValueOnce(
      NextResponse.json({ error: "CAPTCHA service unavailable" }, { status: 503 })
    );
    expect((await challenge()).status).toBe(503);
    // An identifier issued earlier keeps counting.
    const cookie = await minutesAgo(30);
    expect(await (await view(cookie)).json()).toEqual({ ok: true, counted: [POST_ID] });
  });

  it("a browser that has a valid identifier keeps it; no check, no new cookie", async () => {
    const response = await challenge(await minutesAgo(30));
    expect(await response.json()).toEqual({ ok: true });
    expect(issued(response)).toBeNull();
    expect(mocks.captcha).not.toHaveBeenCalled();
  });

  it("the issuing allowance is read before the check and spent only by a successful issue", async () => {
    // No room: refused before the check, nothing spent.
    mocks.rate.mockResolvedValue({ limited: true, retryAfter: 60 });
    const limited = await challenge(null, { "cf-connecting-ip": "2001:db8:1:2:aaaa::1" });
    expect(limited.status).toBe(429);
    expect(mocks.captcha).not.toHaveBeenCalled();
    expect(mocks.rate).toHaveBeenCalledTimes(1);
    expect(mocks.rate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "engagement:viewer",
        key: "v6:2001:db8:1::/48",
        readOnly: true,
      })
    );
    // A failed check spends nothing.
    mocks.rate.mockReset().mockResolvedValue({ limited: false });
    mocks.captcha.mockResolvedValueOnce(
      NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 })
    );
    expect((await challenge(null, { "cf-connecting-ip": "2001:db8:1:ffff::9" })).status).toBe(400);
    expect(mocks.rate.mock.calls.every(([options]) => options.readOnly === true)).toBe(true);
    // A passed check spends one, keyed by the same /48 for another /64.
    mocks.rate.mockClear();
    const ok = await challenge(null, { "cf-connecting-ip": "2001:db8:1:ffff::9" });
    expect(issued(ok)).toMatch(/^v1\./);
    expect(
      mocks.rate.mock.calls.map(([options]) => [options.key, options.readOnly ?? false])
    ).toEqual([
      ["v6:2001:db8:1::/48", true],
      ["v6:2001:db8:1::/48", false],
    ]);
    mocks.rate.mockClear();
    await challenge(null, { "cf-connecting-ip": "::ffff:198.51.100.4" });
    expect(mocks.rate).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "engagement:viewer", key: "v4:198.51.100.4" })
    );
  });

  it("without the signing secret nothing is issued", async () => {
    vi.stubEnv("ENGAGEMENT_COOKIE_SECRET", "");
    try {
      const response = await challenge();
      expect(response.status).toBe(503);
      expect(issued(response)).toBeNull();
    } finally {
      vi.stubEnv("ENGAGEMENT_COOKIE_SECRET", SECRET);
    }
  });
});

describe("engaged video views through the view route", () => {
  const engagedVideo = (id = POST_ID) => ({ type: "business", id, source: "video", engaged: true });

  it("counts an engaged view once per browser, only after its page view counted", async () => {
    const cookie = await minutesAgo(30);
    // No counted view yet: nothing.
    expect(await (await view(cookie, [engagedVideo()])).json()).toEqual({ ok: true, counted: [] });
    expect(db.state.engaged.size).toBe(0);
    // The page view, then the engaged signal in the same request: both count.
    await view(cookie, [pageView(), engagedVideo()]);
    expect(db.state.engaged.size).toBe(1);
    await view(cookie, [engagedVideo()]);
    expect(db.state.engaged.size).toBe(1);
    const engagedCall = db.state.calls.find((call) => call.name === "record_post_activity")!;
    expect(engagedCall.args).toEqual({
      p_post_ids: [POST_ID],
      p_metrics: ["engaged_views"],
      p_device: cookie.split(".")[1],
    });
  });

  it("a plain video play is never a view or an engaged view", async () => {
    const cookie = await minutesAgo(30);
    const response = await view(cookie, [{ type: "business", id: POST_ID, source: "video" }]);
    expect(await response.json()).toEqual({ ok: true, counted: [] });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("an engaged signal without a signed identifier asks for the check", async () => {
    expect(await (await view(null, [engagedVideo()])).json()).toMatchObject({
      needs_challenge: true,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("Performance page events (/api/analytics/events)", () => {
  const events = (
    list: object[],
    headers: Record<string, string> = {},
    cookie: string | null = null
  ) => postEvents(request("/api/analytics/events", { events: list }, { cookie, headers }));
  const card = (type: string, extra: object = {}, id = POST_ID) => ({
    table: "businesses",
    id,
    type,
    ...extra,
  });

  it("maps each event to its daily counter; only showroom appearances need the identifier", async () => {
    const cookie = await minutesAgo(30);
    const response = await events(
      [
        card("impression", { surface: "business_list" }),
        card("search_appearance", { surface: "site_search" }),
        card("homepage_appearance", { surface: "home_business" }),
        card("showroom_appearance", { surface: "showroom:home" }),
        card("showroom_appearance", { surface: "showroom:tourism" }),
        card("showroom_appearance", { surface: "programme:home" }),
        card("organisation_directory_appearance", { surface: "org:x" }),
        card("detail_view", { surface: "detail" }),
        card("detail_view", { surface: "detail", source: "social" }),
        card("whatsapp_click"),
        card("phone_click"),
        card("website_click"),
        card("directions_click"),
        card("booking_click"),
        card("ticket_click"),
        card("share"),
      ],
      {},
      cookie
    );
    expect(response.status).toBe(204);
    expect(db.state.activity.map(([, counter]) => counter)).toEqual([
      "list_impressions",
      "search_appearances",
      "homepage_appearances",
      "showroom_home",
      "showroom_tourism",
      "showroom_programme",
      "directory_appearances",
      "views_direct",
      "views_social",
      "whatsapp_taps",
      "phone_taps",
      "website_taps",
      "directions_taps",
      "booking_taps",
      "ticket_taps",
      "shares",
    ]);
    // Nothing about the visitor but the account check and, for the showroom
    // appearances, the signed identifier reaches the database.
    expect(Object.keys(db.state.calls[0]!.args).sort()).toEqual([
      "p_device",
      "p_metrics",
      "p_post_ids",
    ]);
    expect(db.state.calls[0]!.args.p_device).toBe(cookie.split(".")[1]);
    // Without showroom appearances no identifier is read or sent.
    db.state.calls.length = 0;
    await events([card("share")], {}, cookie);
    expect(Object.keys(db.state.calls[0]!.args).sort()).toEqual(["p_metrics", "p_post_ids"]);
  });

  it("a showroom appearance counts once per browser; without a signed identifier it counts nothing", async () => {
    const appearance = card("showroom_appearance", { surface: "showroom:home" });
    // No identifier: dropped before the database; the other events still count.
    expect((await events([appearance, card("share")])).status).toBe(204);
    expect(db.state.activity).toEqual([[POST_ID, "shares"]]);
    // A made-up identifier counts nothing either.
    const token = (await issueViewerToken())!;
    const forged = `v1.${crypto.randomUUID()}.${Math.floor(Date.now() / 1000)}.${token.value.split(".")[3]}`;
    await events([appearance], {}, forged);
    expect(db.state.activity).toEqual([[POST_ID, "shares"]]);
    // The same browser again: once; another browser: counted.
    const cookie = await minutesAgo(30);
    await events([appearance], {}, cookie);
    await events([appearance], {}, cookie);
    await events([appearance], {}, await minutesAgo(40));
    expect(db.state.activity.filter(([, counter]) => counter === "showroom_home")).toHaveLength(2);
  });

  it("passes the verified account so the owner and staff are not counted", async () => {
    mocks.account.mockResolvedValueOnce({ accountId: ACCOUNT });
    await events([card("share")]);
    expect(db.state.calls[0]!.args.p_account).toBe(ACCOUNT);
  });

  it("saves, sponsor clicks and organisation events are not counted here", async () => {
    const response = await events([
      card("save"),
      card("sponsor_click"),
      { table: "organisations", id: OTHER_ID, type: "impression" },
    ]);
    expect(response.status).toBe(204);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("per-source limit: over it nothing is counted", async () => {
    mocks.rate.mockResolvedValue({ limited: true, retryAfter: 60 });
    const response = await events([card("share")], { "cf-connecting-ip": "2001:db8:1:2::1" });
    expect(response.status).toBe(204);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(mocks.rate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "engagement:activity", key: "v6:2001:db8:1::/48" })
    );
  });

  it("each (post, counter) pair once per request", async () => {
    await events([
      ...Array.from({ length: 30 }, () => card("share")),
      card("share", {}, OTHER_ID),
      card("phone_click"),
    ]);
    expect(db.state.calls[0]!.args).toEqual({
      p_post_ids: [POST_ID, OTHER_ID, POST_ID],
      p_metrics: ["shares", "shares", "phone_taps"],
    });
  });

  it("per-post daily limit: a post over it is dropped silently, the others still count", async () => {
    mocks.rate.mockImplementation(async ({ action, key }: { action: string; key: string }) => ({
      limited: action === "engagement:activity:post" && key.endsWith(POST_ID),
    }));
    const response = await events([card("share"), card("share", {}, OTHER_ID)], {
      "cf-connecting-ip": "198.51.100.4",
    });
    expect(response.status).toBe(204);
    expect(db.state.activity).toEqual([[OTHER_ID, "shares"]]);
    expect(mocks.rate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "engagement:activity:post",
        key: `v4:198.51.100.4|${POST_ID}`,
      })
    );
    // Every post over its limit: no database call at all.
    mocks.rate.mockImplementation(async ({ action }: { action: string }) => ({
      limited: action === "engagement:activity:post",
    }));
    db.rpc.mockClear();
    expect((await events([card("share")])).status).toBe(204);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("the per-post limit covers page events and showroom appearances, not other appearances", async () => {
    mocks.rate.mockImplementation(async ({ action, key }: { action: string; key: string }) => ({
      limited: action === "engagement:activity:post" && key.endsWith(POST_ID),
    }));
    await events(
      [
        card("impression", { surface: "market_list" }),
        card("showroom_appearance", { surface: "showroom:home" }),
        card("showroom_appearance", { surface: "showroom:home" }, OTHER_ID),
        card("detail_view", { surface: "detail" }),
        card("whatsapp_click"),
      ],
      {},
      await minutesAgo(30)
    );
    // The post is over its limit: its page events and its showroom appearance
    // are dropped; its list appearance and the other post's showroom turn count.
    expect(db.state.activity).toEqual([
      [POST_ID, "list_impressions"],
      [OTHER_ID, "showroom_home"],
    ]);
    const perPost = mocks.rate.mock.calls
      .map(([options]) => options as { action: string; key: string })
      .filter((options) => options.action === "engagement:activity:post");
    expect(perPost.map((options) => options.key.split("|")[1]).sort()).toEqual(
      [POST_ID, OTHER_ID].sort()
    );
    // A batch of appearances alone makes one limiter call, for the address.
    mocks.rate.mockClear();
    await events(
      Array.from({ length: 20 }, (_, n) =>
        card("impression", {}, `aaaaaaaa-aaaa-4aaa-8aaa-0000000001${String(n).padStart(2, "0")}`)
      )
    );
    expect(mocks.rate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a crawler", { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }],
    ["a prefetch", { "sec-purpose": "prefetch" }],
  ])("%s is never counted", async (_label, headers) => {
    expect((await events([card("share")], headers)).status).toBe(204);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("refuses a bad payload (more than 50 events, a bad id) and answers 503 when the database fails", async () => {
    expect((await events([])).status).toBe(400);
    expect((await events(Array.from({ length: 51 }, () => card("share")))).status).toBe(400);
    expect((await events([card("share", {}, "not-a-uuid")])).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } } as never);
    expect((await events([card("share")])).status).toBe(503);
  });

  it("a cross-site request is refused by the origin check", async () => {
    mocks.origin.mockReturnValueOnce(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    expect((await events([card("share")])).status).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("views through the route", () => {
  it("a new browser is asked for the check; with the identifier it counts once a day", async () => {
    const first = await view(null);
    expect(await first.json()).toEqual({ ok: true, counted: [], needs_challenge: true });
    expect(issued(first)).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();

    const cookie = issued(await challenge())!;
    expect(await (await view(cookie)).json()).toEqual({ ok: true, counted: [POST_ID] });
    expect(await (await view(cookie)).json()).toEqual({ ok: true, counted: [] });
    expect(db.state.views.get(POST_ID)).toBe(1);
    // The database gets the bare identifier, never the signed cookie, and when
    // it was issued (for the safety valve's trust rule).
    expect(db.state.calls[0]!.args.p_device).toBe(cookie.split(".")[1]);
    expect(Date.parse(db.state.calls[0]!.args.p_device_issued_at as string)).toBe(
      Number(cookie.split(".")[2]) * 1000
    );
  });

  it("a made-up identifier is never counted and never issued a cookie", async () => {
    const token = (await issueViewerToken())!;
    for (const forged of [
      crypto.randomUUID(),
      `v1.${crypto.randomUUID()}.${Math.floor(Date.now() / 1000)}.${token.value.split(".")[3]}`,
      `${token.value.slice(0, -2)}AA`,
      `v1.${token.id}.${Math.floor(Date.now() / 1000) + 3600}.${token.value.split(".")[3]}`,
      (await issueViewerToken(Date.now() - 500 * 24 * 3600 * 1000))!.value,
    ]) {
      const response = await view(forged);
      expect(await response.json()).toMatchObject({ counted: [], needs_challenge: true });
      expect(issued(response)).toBeNull();
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("per-source limits: at most three page views a request, each within the per-address, per-post limit", async () => {
    const cookie = await minutesAgo(30);
    const ids = Array.from({ length: 6 }, (_, n) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000001${n}`);
    mocks.rate.mockImplementation(async ({ key }: { key: string }) => ({
      limited: key.endsWith(ids[1]!),
    }));
    const response = await view(
      cookie,
      ids.map((id) => pageView(id)),
      { "cf-connecting-ip": "2001:db8:1:2:aaaa::1" }
    );
    expect((await response.json()).counted).toEqual([ids[0], ids[2]]);
    expect(mocks.rate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "engagement:view:post",
        key: `v6:2001:db8:1::/48|${ids[0]}`,
      })
    );
  });

  it.each([
    ["a crawler", { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }],
    ["a headless browser", { "user-agent": "Mozilla/5.0 HeadlessChrome/130.0" }],
    ["a prefetch", { "sec-purpose": "prefetch" }],
    ["a router prefetch", { "next-router-prefetch": "1" }],
  ])("%s is never counted", async (_label, headers) => {
    const response = await view(await minutesAgo(30), [pageView()], headers);
    expect(await response.json()).toEqual({ ok: true, counted: [] });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("refuses a bad payload, and answers 503 when the database fails", async () => {
    const cookie = await minutesAgo(30);
    expect((await view(cookie, [])).status).toBe(400);
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } } as never);
    expect((await view(cookie)).status).toBe(503);
  });
});

describe("likes through the route", () => {
  it("a signed-out like needs the identifier (428), then persists and toggles off", async () => {
    const asked = await like(null, { targetId: POST_ID, targetType: "listing", liked: true });
    expect(asked.status).toBe(428);
    expect(await asked.json()).toMatchObject({ needs_challenge: true });
    const cookie = await minutesAgo(30);
    expect(
      await (await like(cookie, { targetId: POST_ID, targetType: "listing", liked: true })).json()
    ).toEqual({ liked: true, likeCount: 1, counted: true });
    expect(
      await (await like(cookie, { targetId: POST_ID, targetType: "listing", liked: true })).json()
    ).toEqual({ liked: true, likeCount: 1, counted: true });
    expect(await (await like(cookie, { targetId: POST_ID, targetType: "listing" })).json()).toEqual(
      { liked: false, likeCount: 0, counted: true }
    );
  });

  it("passes the identifier's issue time, so the database can hold back likes from new identifiers", async () => {
    const fresh = (await issueViewerToken())!;
    await like(fresh.value, { targetId: POST_ID, targetType: "listing", liked: true });
    const sent = db.state.calls.at(-1)!.args.p_device_issued_at as string;
    expect(Math.abs(Date.parse(sent) - Date.now())).toBeLessThan(5_000);
  });

  it("signed in, the like is the account's, with or without the cookie, and no issue time", async () => {
    mocks.account.mockResolvedValue({ accountId: ACCOUNT });
    const response = await like(null, { targetId: OTHER_ID, targetType: "listing", liked: true });
    expect(await response.json()).toEqual({ liked: true, likeCount: 1, counted: true });
    expect(db.state.calls.at(-1)!.args).toMatchObject({ p_account: ACCOUNT, p_liked: true });
    expect(db.state.calls.at(-1)!.args).not.toHaveProperty("p_device_issued_at");
    await like(await minutesAgo(1), { targetId: OTHER_ID, targetType: "listing", liked: true });
    expect(db.state.calls.at(-1)!.args).not.toHaveProperty("p_device_issued_at");
  });

  it("per-source limits: new likes per address and post a day, never for an unlike", async () => {
    const cookie = await minutesAgo(30);
    mocks.rate.mockImplementation(async ({ action }: { action: string }) => ({
      limited: action === "engagement:like:post",
    }));
    const limited = await like(cookie, { targetId: POST_ID, targetType: "listing", liked: true });
    expect(limited.status).toBe(429);
    expect(mocks.rate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "engagement:like:post", key: `v4:203.0.113.7|${POST_ID}` })
    );
    const unlike = await like(cookie, { targetId: POST_ID, targetType: "listing", liked: false });
    expect(unlike.status).toBe(200);
  });

  it("maps refusals: hidden post 404, failure 503", async () => {
    const cookie = await minutesAgo(30);
    const body = { targetId: POST_ID, targetType: "listing" };
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } } as never);
    expect((await like(cookie, body)).status).toBe(404);
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } } as never);
    expect((await like(cookie, body)).status).toBe(503);
  });

  it("refuses a crawler, a request over the limit, a bad body and a failed CSRF check", async () => {
    const cookie = await minutesAgo(30);
    const body = { targetId: POST_ID, targetType: "listing" };
    expect((await like(cookie, body, { "user-agent": "curl/8.0" })).status).toBe(403);
    mocks.rate.mockResolvedValueOnce({ limited: true, retryAfter: 30 });
    expect((await like(cookie, body)).status).toBe(429);
    expect((await like(cookie, { targetId: "x", targetType: "listing" })).status).toBe(400);
    mocks.guard.mockReturnValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await like(cookie, body)).status).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
