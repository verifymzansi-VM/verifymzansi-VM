/** @vitest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The view and like routes with SHOW_ENGAGEMENT_TOTALS on (as at launch). The
// database rules are proven by scripts/test-foundation-post-views-and-likes.mjs;
// here: what reaches the database, and what never does.
const mocks = vi.hoisted(() => ({
  serviceRpc: vi.fn(),
  guard: vi.fn(),
  origin: vi.fn(),
  rate: vi.fn(),
  account: vi.fn(),
}));
vi.mock("@/lib/hidden-features", () => ({ SHOW_ENGAGEMENT_TOTALS: true }));
vi.mock("@/lib/foundation/service-api", () => ({
  createFoundationServiceApi: () => ({ rpc: mocks.serviceRpc }),
}));
vi.mock("@/lib/utils/mutation-guard", () => ({ enforceMutationRequest: mocks.guard }));
vi.mock("@/lib/utils/mutation-origin", () => ({ enforceSameOriginMutation: mocks.origin }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mocks.rate,
  getClientRateLimitIdentity: () => ({ key: "synthetic-address" }),
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

import { POST as postView } from "./view/route";
import { POST as postLike } from "./like/route";

const POST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const OTHER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const DEVICE = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-000000000001";
const BROWSER =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

function request(
  path: string,
  body: unknown,
  { cookie = true, headers = {} }: { cookie?: boolean; headers?: Record<string, string> } = {}
) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": BROWSER,
      ...(cookie ? { cookie: `vmz_viewer=${DEVICE}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const views = (events: object[], options?: Parameters<typeof request>[2]) =>
  postView(request("/api/engagement/view", { events }, options));
const pageView = (id = POST_ID) => ({ type: "business", id, source: "page", surface: "detail" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockReturnValue(null);
  mocks.origin.mockReturnValue(null);
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.account.mockRejectedValue(new Error("signed out"));
});

describe("POST /api/engagement/view", () => {
  it("sends page views with the browser identifier and the signed-in account", async () => {
    mocks.account.mockResolvedValue({ accountId: ACCOUNT });
    mocks.serviceRpc.mockResolvedValue({ data: { counted: [POST_ID] }, error: null });
    const response = await views([
      pageView(),
      pageView(),
      { type: "listing", id: OTHER_ID, source: "video", surface: "grid:market" },
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, counted: [POST_ID] });
    expect(mocks.serviceRpc).toHaveBeenCalledWith("record_post_views", {
      p_post_ids: [POST_ID],
      p_device: DEVICE,
      p_account: ACCOUNT,
    });
    expect(mocks.rate).toHaveBeenCalledWith(
      expect.objectContaining({ key: "synthetic-address", action: "engagement:view" })
    );
  });

  it("signed out: no account is sent", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: { counted: [] }, error: null });
    await views([pageView()]);
    expect(mocks.serviceRpc).toHaveBeenCalledWith("record_post_views", {
      p_post_ids: [POST_ID],
      p_device: DEVICE,
    });
  });

  it("a browser without the cookie gets one, is asked to send again, and is not counted", async () => {
    const response = await views([pageView()], { cookie: false });
    expect(await response.json()).toEqual({ ok: true, counted: [], retry: true });
    expect(response.headers.get("set-cookie")).toMatch(
      /^vmz_viewer=[0-9a-f-]{36}; Path=\/; Expires=.*; Max-Age=31536000; HttpOnly; SameSite=lax$/i
    );
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a crawler", { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }],
    ["a headless browser", { "user-agent": "Mozilla/5.0 HeadlessChrome/130.0" }],
    ["a prefetch", { "sec-purpose": "prefetch" }],
    ["a router prefetch", { "next-router-prefetch": "1" }],
  ])("%s is never counted", async (_label, headers) => {
    const response = await views([pageView()], { headers });
    expect(await response.json()).toEqual({ ok: true, counted: [] });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("video plays alone send nothing and set no cookie", async () => {
    const response = await views([{ type: "listing", id: POST_ID, source: "video" }], {
      cookie: false,
    });
    expect(await response.json()).toEqual({ ok: true, counted: [] });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("over the per-address limit: not counted, no database call", async () => {
    mocks.rate.mockResolvedValue({ limited: true, retryAfter: 30 });
    const response = await views([pageView()]);
    expect(await response.json()).toEqual({ ok: true, counted: [] });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("a cross-site request is refused by the origin check", async () => {
    mocks.origin.mockReturnValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await views([pageView()])).status).toBe(403);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("refuses a bad payload and answers 503 when the database fails", async () => {
    expect((await views([])).status).toBe(400);
    expect((await views([{ type: "business", id: "not-a-uuid", source: "page" }])).status).toBe(
      400
    );
    mocks.serviceRpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect((await views([pageView()])).status).toBe(503);
  });

  it("rejects a database answer naming a post it was not sent", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: { counted: [OTHER_ID] }, error: null });
    expect((await views([pageView()])).status).toBe(503);
  });
});

describe("POST /api/engagement/like", () => {
  const like = (body: object, options?: Parameters<typeof request>[2]) =>
    postLike(request("/api/engagement/like", body, options));

  it("sets the like asked for, signed in or not", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: { liked: true, likes: 4, counted: true },
      error: null,
    });
    const response = await like({ targetId: POST_ID, targetType: "listing", liked: true });
    expect(await response.json()).toEqual({ liked: true, likeCount: 4, counted: true });
    expect(mocks.serviceRpc).toHaveBeenCalledWith("set_post_like", {
      p_post_id: POST_ID,
      p_device: DEVICE,
      p_liked: true,
    });
    expect(response.headers.get("set-cookie")).toBeNull();

    mocks.account.mockResolvedValue({ accountId: ACCOUNT });
    await like({ targetId: POST_ID, targetType: "listing" });
    expect(mocks.serviceRpc).toHaveBeenLastCalledWith("set_post_like", {
      p_post_id: POST_ID,
      p_device: DEVICE,
      p_account: ACCOUNT,
    });
  });

  it("a first like from a browser starts its identifier with the same value", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: { liked: true, likes: 1, counted: true },
      error: null,
    });
    const response = await like({ targetId: POST_ID, targetType: "listing" }, { cookie: false });
    const sent = mocks.serviceRpc.mock.calls[0][1].p_device as string;
    expect(response.headers.get("set-cookie")).toContain(`vmz_viewer=${sent};`);
  });

  it("maps refusals: hidden post 404, per-post limit 429, failure 503", async () => {
    const body = { targetId: POST_ID, targetType: "listing" };
    mocks.serviceRpc.mockResolvedValueOnce({ data: null, error: { code: "PT404" } });
    expect((await like(body)).status).toBe(404);
    mocks.serviceRpc.mockResolvedValueOnce({ data: null, error: { code: "PT429" } });
    expect((await like(body)).status).toBe(429);
    mocks.serviceRpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } });
    expect((await like(body)).status).toBe(503);
  });

  it("refuses a crawler, a request over the limit, a bad body and a failed CSRF check", async () => {
    const body = { targetId: POST_ID, targetType: "listing" };
    expect((await like(body, { headers: { "user-agent": "curl/8.0" } })).status).toBe(403);
    mocks.rate.mockResolvedValueOnce({ limited: true, retryAfter: 30 });
    expect((await like(body)).status).toBe(429);
    expect((await like({ targetId: "x", targetType: "listing" })).status).toBe(400);
    mocks.guard.mockReturnValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await like(body)).status).toBe(403);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });
});
