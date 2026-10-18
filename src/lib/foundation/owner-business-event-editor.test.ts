/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import reference from "../domains/taxonomy/reference.json";
import { createFoundationAuthenticatedApi } from "./authenticated-api";
import {
  parseFoundationBusinessEventEditor as parse,
  readFoundationBusinessEventEditor as read,
} from "./owner-business-event-editor";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const token = `e30.${Buffer.from(JSON.stringify({ role: "authenticated", sub: id, session_id: other })).toString("base64url")}.c2ln`;
const api = (fetcher: typeof fetch) =>
  createFoundationAuthenticatedApi(
    {
      url: "http://127.0.0.1:55443",
      expectedProjectRef: "local-foundation",
      publishableKey: "sb_publishable_synthetic",
    },
    token,
    fetcher
  );
const business = () => ({
  id,
  kind: "business",
  area: "business",
  category_key: "automotive_services",
  activity_key: null,
  status: "draft",
  revision: 1,
  edit_of: null,
  content: {
    title: null,
    description: null,
    province_id: null,
    city_id: null,
    locality_label: null,
  },
  event_window: null,
  media: [],
});
const event = () => ({
  ...business(),
  kind: "event",
  area: "tourism_events",
  category_key: "events",
  activity_key: reference.activities.find((row) => row.category === "events")!.key,
  event_window: {
    starts_at: "2020-01-01T00:00:00.000Z",
    ends_at: "2020-01-01T01:00:00.000Z",
    timezone: "US/Eastern",
  },
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
it("restores incomplete business metadata and ended event windows without changing stored zone aliases", () => {
  expect(parse(business())).toEqual(business());
  expect(parse(event())).toEqual(event());
  expect(
    parse({
      ...business(),
      area: "tourism_events",
      category_key: "tourism_hospitality",
      activity_key: "tour_operator",
    })
  ).toHaveProperty("activity_key", "tour_operator");
  expect(parse(null)).toBeNull();
});
it("rejects private fields and invalid kind/category/activity/window pairs", () => {
  for (const value of [
    { ...business(), owner_id: other },
    { ...business(), kind: "listing" },
    { ...business(), area: "market" },
    { ...business(), category_key: "events" },
    { ...event(), activity_key: null },
    { ...event(), activity_key: "tour_operator" },
    { ...business(), event_window: event().event_window },
    { ...event(), event_window: null },
    { ...event(), event_window: { ...event().event_window, object_key: "private" } },
  ])
    expect(() => parse(value)).toThrow(/^Invalid foundation business\/event editor$/);
});
it("uses UTF16 bounds separately for business and event text", () => {
  for (const [value, titleMax, descriptionMax] of [
    [business(), 100, 3000],
    [event(), 120, 5000],
  ] as const) {
    const title = "😀".repeat(titleMax / 2),
      description = "😀".repeat(descriptionMax / 2);
    expect(
      parse({ ...value, content: { ...value.content, title, description } })?.content
    ).toMatchObject({ title, description });
    expect(() => parse({ ...value, content: { ...value.content, title: title + "😀" } })).toThrow();
    expect(() =>
      parse({ ...value, content: { ...value.content, description: description + "😀" } })
    ).toThrow();
  }
});
it("rejects malformed, overlong and nonpositive event windows but allows archived past events", () => {
  expect(parse({ ...event(), status: "archived" })).toHaveProperty("status", "archived");
  for (const window of [
    { ...event().event_window, starts_at: "2020-01-01T00:00:00.000001Z" },
    { ...event().event_window, ends_at: "2020-01-01T00:00:00.000Z" },
    { ...event().event_window, ends_at: "2020-04-02T00:00:00.000Z" },
    { ...event().event_window, timezone: "private\nzone" },
  ])
    expect(() => parse({ ...event(), event_window: window })).toThrow();
});
it("permits owned reference reuse in different purposes while rejecting duplicates and byte-access fields", () => {
  const item = {
    object_id: other,
    kind: "image",
    state: "ready",
    purpose: "cover",
    position: 0,
    width: 1200,
    height: 800,
    focal_x: null,
    focal_y: null,
  };
  expect(
    parse({ ...business(), media: [item, { ...item, purpose: "gallery" }] })?.media
  ).toHaveLength(2);
  for (const media of [
    [item, item],
    [item, { ...item, object_id: id }],
    [{ ...item, object_key: "private" }],
    [{ ...item, width: null }],
    [{ ...item, purpose: "video" }],
  ])
    expect(() => parse({ ...business(), media })).toThrow();
});
it("validates edit-copy state and readable terminal revision without granting mutation authority", () => {
  expect(
    parse({ ...business(), edit_of: other, status: "pending_moderation", revision: 2147483647 })
  ).toHaveProperty("revision", 2147483647);
  for (const value of [
    { ...business(), edit_of: id },
    { ...business(), edit_of: other, status: "live" },
    { ...business(), status: "sold" },
    { ...business(), revision: 0 },
  ])
    expect(() => parse(value)).toThrow();
});
it("makes one caller-bound read with a normalized UUID and distinguishes normal null", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(event()));
  expect(await read(api(fetcher), { id: id.toUpperCase() })).toEqual(event());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ p_post_id: id });
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("authorization")).toBe(
    `Bearer ${token}`
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    await read(
      api(async () => response(null)),
      { id }
    )
  ).toBeNull();
});
it("rejects malformed requests before RPC and mismatched or private response identities", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(business()));
  await expect(read(api(fetcher), { id, owner_id: other })).rejects.toThrow(
    /^Invalid foundation business\/event editor request$/
  );
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    read(
      api(async () => response({ ...business(), id: other })),
      { id }
    )
  ).rejects.toThrow(/^Invalid foundation business\/event editor$/);
});
it("hides server and thrown transport diagnostics without retrying", async () => {
  for (const fn of [
    async () => response({ code: "42501", message: "private" }, 403),
    async () => {
      throw new Error("private transport");
    },
  ]) {
    const fetcher = vi.fn<typeof fetch>(fn);
    await expect(read(api(fetcher), { id })).rejects.toThrow(
      /^Foundation business\/event editor unavailable$/
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it("rejects 101 otherwise distinct media references rather than returning a truncated editor", () => {
  const media = Array.from({ length: 101 }, (_, n) => ({
    object_id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
    kind: n < 50 ? "image" : n < 100 ? "video" : "image",
    state: "intent",
    purpose: n < 50 ? "gallery" : n < 100 ? "video" : "logo",
    position: n % 50,
    width: null,
    height: null,
    focal_x: null,
    focal_y: null,
  }));
  expect(() => parse({ ...business(), media })).toThrow(
    /^Invalid foundation business\/event editor$/
  );
});
