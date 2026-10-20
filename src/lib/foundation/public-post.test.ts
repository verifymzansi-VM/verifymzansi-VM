/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationPublicApi } from "./public-api";
import { parseFoundationPublicPost, readFoundationPublicPost } from "./public-post";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const object = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const config = {
  url: "http://127.0.0.1:55443",
  expectedProjectRef: "local-foundation",
  publishableKey: "sb_publishable_synthetic",
};
const detail = () => ({
  id,
  kind: "listing",
  area: "market",
  category: "electronics",
  activity: null,
  title: "Synthetic device",
  description: "Synthetic public description only",
  province: "gp",
  city: "gp_johannesburg",
  locality: "Johannesburg",
  price_mode: "on_request",
  price_cents: null,
  price_negotiable: true,
  condition: "good",
  published_at: "2026-10-16T10:00:00.123456+00:00",
  visible_until: "2026-10-17T10:00:00Z",
  event_window: null,
  media: [
    {
      purpose: "cover",
      position: 0,
      object_key: `media/${object}`,
      kind: "image",
      width: 800,
      height: 600,
      focal_x: null,
      focal_y: null,
    },
  ],
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
it("distinguishes a null unavailable post from malformed data and preserves price/cursor precision", () => {
  expect(parseFoundationPublicPost(null)).toBeNull();
  expect(parseFoundationPublicPost(detail())).toEqual(detail());
  for (const bad of [
    undefined,
    [],
    { ...detail(), owner_id: id },
    { ...detail(), price_negotiable: "true" },
    { ...detail(), price_mode: "free", price_cents: "0" },
    { ...detail(), media: [{ ...detail().media[0], object_key: "evidence/private" }] },
    { ...detail(), media: [{ ...detail().media[0], object_key: "https://remote.invalid/image" }] },
  ])
    expect(() => parseFoundationPublicPost(bad)).toThrow("Invalid foundation public post");
});
it("rejects duplicate media slots, invalid kinds/dimensions/focals and private metadata", () => {
  const item = detail().media[0];
  for (const media of [
    [item, item],
    [{ ...item, purpose: "video" }],
    [{ ...item, width: 0 }],
    [{ ...item, width: null }],
    [{ ...item, focal_x: 1.1 }],
    [{ ...item, owner_id: id }],
  ])
    expect(() => parseFoundationPublicPost({ ...detail(), media })).toThrow();
  expect(
    parseFoundationPublicPost({
      ...detail(),
      media: [{ ...item, purpose: "video", kind: "video", width: null, height: null }],
    })
  ).not.toBeNull();
});
it("binds the requested UUID, normalises accepted UUID case and makes one RPC without table fallback", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => response(detail()));
  const api = createFoundationPublicApi(config, fetcher);
  expect(await readFoundationPublicPost(api, { id: id.toUpperCase() })).toEqual(detail());
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ p_id: id });
  await expect(readFoundationPublicPost(api, { id, actor_id: id })).rejects.toThrow(
    "Invalid foundation public post request"
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const different = createFoundationPublicApi(config, async () =>
    response({ ...detail(), id: object })
  );
  await expect(readFoundationPublicPost(different, { id })).rejects.toThrow(
    "Invalid foundation public post"
  );
});
it("preserves ordinary null results and safely rejects transport errors", async () => {
  expect(
    await readFoundationPublicPost(
      createFoundationPublicApi(config, async () => response(null)),
      { id }
    )
  ).toBeNull();
  const fetcher = vi.fn<typeof fetch>(async () =>
    response({ code: "42501", message: "private diagnostic" }, 403)
  );
  await expect(
    readFoundationPublicPost(createFoundationPublicApi(config, fetcher), { id })
  ).rejects.toThrow(/^Foundation public post unavailable$/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

const eventDetail = () => ({
  ...detail(),
  kind: "event",
  area: "tourism_events",
  category: "events",
  activity: "community",
  price_mode: null,
  price_cents: null,
  price_negotiable: false,
  condition: null,
  event_window: {
    starts_at: "2026-10-16T12:00:00.123Z",
    ends_at: "2026-10-16T20:00:00.123Z",
    timezone: "US/Eastern",
  },
});
it("restores exact approved event instants and stored timezone aliases, with null non-event windows", () => {
  expect(parseFoundationPublicPost(eventDetail())).toEqual(eventDetail());
  const business = {
    ...detail(),
    kind: "business",
    area: "business",
    category: "automotive_services",
    price_mode: null,
    price_cents: null,
    price_negotiable: false,
    condition: null,
  };
  expect(parseFoundationPublicPost(business)).toEqual(business);
  expect(parseFoundationPublicPost(detail())?.event_window).toBeNull();
  for (const invalid of [
    { ...detail(), event_window: eventDetail().event_window },
    { ...business, event_window: eventDetail().event_window },
    { ...eventDetail(), event_window: null },
    { ...eventDetail(), event_window: undefined },
  ])
    expect(() => parseFoundationPublicPost(invalid)).toThrow("Invalid foundation public post");
});
it("rejects partial, private, invalid precision, year, duration and timezone event data", () => {
  const w = eventDetail().event_window;
  for (const event_window of [
    {},
    { starts_at: w.starts_at },
    { ...w, owner_id: id },
    { ...w, timezone: "US Eastern" },
    { ...w, starts_at: "0000-01-01T00:00:00.000Z", ends_at: "0000-01-01T01:00:00.000Z" },
    { ...w, starts_at: "2026-10-16T12:00:00.123456Z" },
    { ...w, starts_at: "2026-10-16T12:00:00.123+00:00" },
    { ...w, ends_at: w.starts_at },
    { ...w, ends_at: "2027-01-16T20:00:00.123Z" },
    { ...w, ends_at: "2026-02-30T20:00:00.123Z" },
  ])
    expect(() => parseFoundationPublicPost({ ...eventDetail(), event_window })).toThrow(
      "Invalid foundation public post"
    );
});
