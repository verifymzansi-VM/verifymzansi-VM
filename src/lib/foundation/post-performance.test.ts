import { describe, expect, it, vi } from "vitest";
import {
  activityCounter,
  FoundationActivityError,
  readFoundationPostPerformance,
  recordFoundationPostActivity,
} from "./post-performance";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";

const POST = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const DEVICE = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-000000000001";

const service = (result: { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async () => result);
  return { api: { rpc } as unknown as FoundationServiceApi, rpc };
};
const member = (result: { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async () => result);
  return { api: { rpc } as unknown as FoundationAuthenticatedApi, rpc };
};

const performance = {
  posts: 3,
  live_posts: 2,
  views: 40,
  engaged_views: 5,
  leads: 2,
  last_30_days: {
    impression: 120,
    detail_view: 30,
    whatsapp_click: 4,
    phone_click: 1,
    website_click: 0,
    directions_click: 0,
    booking_click: 0,
    ticket_click: 0,
    showroom_appearance: 12,
    organisation_directory_appearance: 0,
    search_appearance: 7,
    homepage_appearance: 9,
    share: 2,
    save: 3,
    unique_viewers: 25,
  },
  top_posts: [
    {
      post_id: POST,
      title: "Braai stand",
      area: "market",
      appearances: 148,
      views: 30,
      unique_viewers: 25,
      contacts: 5,
      saves: 3,
      shares: 2,
    },
  ],
  sources: [
    { source: "direct", views: 20 },
    { source: "social", views: 10 },
  ],
  showroom_turns: [
    {
      post_id: POST,
      title: "Braai stand",
      surface: "home",
      appearances: 12,
      fair_share: 10.5,
      eligible_posts: 14,
    },
  ],
};

describe("activityCounter", () => {
  it.each([
    [{ type: "impression" }, "list_impressions"],
    [{ type: "search_appearance" }, "search_appearances"],
    [{ type: "homepage_appearance" }, "homepage_appearances"],
    [{ type: "showroom_appearance", surface: "showroom:market" }, "showroom_market"],
    [{ type: "showroom_appearance", surface: "programme:home" }, "showroom_programme"],
    [{ type: "showroom_appearance" }, "showroom_programme"],
    [{ type: "organisation_directory_appearance" }, "directory_appearances"],
    [{ type: "detail_view" }, "views_direct"],
    [{ type: "detail_view", source: "internal" }, "views_internal"],
    [{ type: "detail_view", source: "made-up" }, "views_direct"],
    [{ type: "ticket_click" }, "ticket_taps"],
    [{ type: "share" }, "shares"],
    [{ type: "save" }, null],
    [{ type: "sponsor_click" }, null],
  ])("%j -> %s", (event, counter) => {
    expect(activityCounter(event)).toBe(counter);
  });
});

describe("recordFoundationPostActivity", () => {
  it("sends the events as two arrays, with the account and device only when given", async () => {
    const { api, rpc } = service({ data: { posts: 1, engaged: 0 }, error: null });
    await recordFoundationPostActivity(api, {
      events: [
        { postId: POST, counter: "shares" },
        { postId: POST, counter: "views_search" },
      ],
      device: null,
      account: null,
    });
    expect(rpc).toHaveBeenCalledWith("record_post_activity", {
      p_post_ids: [POST, POST],
      p_metrics: ["shares", "views_search"],
    });
    await recordFoundationPostActivity(api, {
      events: [{ postId: POST, counter: "engaged_views" }],
      device: DEVICE,
      account: ACCOUNT,
    });
    expect(rpc).toHaveBeenLastCalledWith("record_post_activity", {
      p_post_ids: [POST],
      p_metrics: ["engaged_views"],
      p_device: DEVICE,
      p_account: ACCOUNT,
    });
  });

  it("refuses an empty or oversized batch before calling the database", async () => {
    const { api, rpc } = service({ data: { posts: 0, engaged: 0 }, error: null });
    await expect(
      recordFoundationPostActivity(api, { events: [], device: null, account: null })
    ).rejects.toThrow();
    await expect(
      recordFoundationPostActivity(api, {
        events: Array.from({ length: 51 }, () => ({ postId: POST, counter: "shares" as const })),
        device: null,
        account: null,
      })
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("names a 22023 refusal and fails on any other error or answer", async () => {
    const input = {
      events: [{ postId: POST, counter: "shares" as const }],
      device: null,
      account: null,
    };
    await expect(
      recordFoundationPostActivity(service({ data: null, error: { code: "22023" } }).api, input)
    ).rejects.toBeInstanceOf(FoundationActivityError);
    await expect(
      recordFoundationPostActivity(service({ data: null, error: { code: "XX000" } }).api, input)
    ).rejects.toThrow("Post activity command failed");
    await expect(
      recordFoundationPostActivity(service({ data: { posts: -1 }, error: null }).api, input)
    ).rejects.toThrow();
  });
});

describe("readFoundationPostPerformance", () => {
  it("reads the owner's figures with a POST call", async () => {
    const { api, rpc } = member({ data: performance, error: null });
    expect(await readFoundationPostPerformance(api)).toEqual(performance);
    expect(rpc).toHaveBeenCalledWith("get_my_post_performance", {}, { get: false });
  });

  it("refuses an answer with unknown or missing fields, and a failed read", async () => {
    await expect(
      readFoundationPostPerformance(member({ data: { ...performance, extra: 1 }, error: null }).api)
    ).rejects.toThrow();
    const { leads: _leads, ...withoutLeads } = performance;
    await expect(
      readFoundationPostPerformance(member({ data: withoutLeads, error: null }).api)
    ).rejects.toThrow();
    await expect(
      readFoundationPostPerformance(member({ data: null, error: { code: "42501" } }).api)
    ).rejects.toThrow("Post performance could not be loaded");
  });
});
