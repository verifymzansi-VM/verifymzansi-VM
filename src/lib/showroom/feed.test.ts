import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchFoundationPresentedCards, loadFoundationShowroom, resolveIpGeolocation, warn } =
  vi.hoisted(() => ({
    searchFoundationPresentedCards: vi.fn(),
    loadFoundationShowroom: vi.fn(),
    resolveIpGeolocation: vi.fn(),
    warn: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: () => ({}) }));
vi.mock("@/lib/foundation/public-cards", () => ({
  searchFoundationPresentedCards,
  loadFoundationShowroom,
  foundationMediaUrl: (key: string | null) => (key ? `/media/${key}` : null),
}));
vi.mock("@/lib/services/ip-geolocation", () => ({ resolveIpGeolocation }));
vi.mock("@/lib/utils/logger", () => ({ createLogger: () => ({ warn, error: vi.fn() }) }));

import { loadShowroomItems, resetShowroomCachesForTests, showroomVisitorArea } from "./feed";

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "listing",
  area: "market",
  title: `Post ${id.slice(0, 4)}`,
  summary: "Barely used",
  locality: "Durban",
  price_cents: "125000",
  preview: { image_key: "img.jpg", video_key: null },
  is_new: false,
  ...extra,
});
const ID = (n: number) => `${n}d5e6f70-8192-4a3b-9c4d-5e6f708192a3`;
const KEY = (n: number) => `media/${n}0000000-0000-4000-8000-000000000000`;
/** A presented search card with owner pictures of the given purposes. */
const presented = (
  id: string,
  media: { purpose: "poster" | "logo"; key: string }[],
  extra: Record<string, unknown> = {}
) => ({
  ...card(id, extra),
  presentation: {
    business_type: null,
    event_window: null,
    frontend: {
      data: {},
      media: media.map(({ purpose, key }) => ({
        purpose,
        position: 0,
        object_key: key,
        width: 720,
        height: 1280,
      })),
    },
  },
});
/** The newest-posts reads (the fallback), not the per-card presentation reads. */
const newestReads = () =>
  searchFoundationPresentedCards.mock.calls.filter(
    ([, input]) => !("post_id" in (input as object))
  );
const first = () => 0;
/** A province no other test uses, so no remembered order carries over. */
const onlyIn = (province: string) => ({ country: "ZA", regionCode: "XX", province, city: null });
let surfaceCall = 0;
/** A different area per test, so the minute's remembered order never carries over. */
const area = () => ({
  country: "ZA",
  regionCode: "KZN",
  province: "KwaZulu-Natal",
  city: ["Durban", "Pietermaritzburg", "Richards Bay", "Newcastle", "Ballito"][surfaceCall++ % 5],
});

describe("showroomVisitorArea", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives the foundation province and city of a listed city", () => {
    resolveIpGeolocation.mockReturnValue({
      country: "ZA",
      regionCode: "KZN",
      province: "KwaZulu-Natal",
      city: "Durban",
    });
    expect(showroomVisitorArea()).toEqual({ province: "kzn", city: "kzn_durban" });
  });

  it("gives the province alone for a city the site does not list", () => {
    resolveIpGeolocation.mockReturnValue({
      country: "ZA",
      regionCode: "GP",
      province: "Gauteng",
      city: "Nowhere-on-the-list",
    });
    expect(showroomVisitorArea()).toEqual({ province: "gp" });
  });

  it("gives nothing outside South Africa, without data, or when reading fails", () => {
    resolveIpGeolocation.mockReturnValue({
      country: "GB",
      regionCode: "ENG",
      province: null,
      city: "London",
    });
    expect(showroomVisitorArea()).toEqual({});
    resolveIpGeolocation.mockReturnValue(null);
    expect(showroomVisitorArea()).toEqual({});
    resolveIpGeolocation.mockImplementation(() => {
      throw new Error("No request context");
    });
    expect(showroomVisitorArea()).toEqual({});
  });
});

describe("loadShowroomItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetShowroomCachesForTests();
    resolveIpGeolocation.mockImplementation(area);
    searchFoundationPresentedCards.mockResolvedValue({ items: [] });
  });

  it("asks for the fair order of the visitor's area and tags new posts", async () => {
    resolveIpGeolocation.mockReturnValue({
      country: "ZA",
      regionCode: "WC",
      province: "Western Cape",
      city: "Cape Town",
    });
    loadFoundationShowroom.mockResolvedValue([card(ID(1), { is_new: true }), card(ID(2))]);
    const items = await loadShowroomItems("market", first);
    expect(loadFoundationShowroom).toHaveBeenCalledWith(
      {},
      { showroom: "market", province: "wc", city: "wc_cape_town" }
    );
    expect(items).toEqual([
      {
        id: ID(1),
        type: "listing",
        href: `/listing/${ID(1)}`,
        title: "Post 1d5e",
        description: "Barely used",
        location: "Durban",
        mediaUrl: "/media/img.jpg",
        mediaKind: "image",
        posterUrl: "/media/img.jpg",
        price: 1250,
        statusLabel: "New",
        statusClassName: expect.stringContaining("bg-brand-gold"),
      },
      expect.objectContaining({ id: ID(2) }),
    ]);
    expect(items[1]).not.toHaveProperty("statusLabel");
    expect(items[0]).not.toHaveProperty("logoUrl");
    expect(newestReads()).toHaveLength(0);
    // One presentation read per card, for its chosen video frame and logo.
    expect(searchFoundationPresentedCards).toHaveBeenCalledTimes(2);
    expect(searchFoundationPresentedCards).toHaveBeenCalledWith(
      {},
      { post_id: ID(1), offset: 0, limit: 1 }
    );
  });

  it("asks the all-South-Africa queue when the area is unknown", async () => {
    resolveIpGeolocation.mockReturnValue(null);
    loadFoundationShowroom.mockResolvedValue([]);
    await expect(loadShowroomItems("tourism", first)).resolves.toEqual([]);
    expect(loadFoundationShowroom).toHaveBeenCalledWith({}, { showroom: "tourism" });
  });

  it("puts one of the first three at the front and keeps the rest in order", async () => {
    loadFoundationShowroom.mockResolvedValue([1, 2, 3, 4].map((n) => card(ID(n))));
    const order = (items: { id: string }[]) => items.map((item) => item.id);
    expect(order(await loadShowroomItems("home", () => 0.99))).toEqual([
      ID(3),
      ID(1),
      ID(2),
      ID(4),
    ]);
  });

  it("remembers a failed fair read for a minute: one database read per visit", async () => {
    vi.useFakeTimers();
    try {
      resolveIpGeolocation.mockReturnValue({
        country: "ZA",
        regionCode: "GP",
        province: "Gauteng",
        city: "Sandton",
      });
      loadFoundationShowroom.mockRejectedValue(new Error("Synthetic timeout"));
      searchFoundationPresentedCards.mockResolvedValue({ items: [card(ID(6))] });
      await loadShowroomItems("market", first);
      await loadShowroomItems("market", first);
      expect(loadFoundationShowroom).toHaveBeenCalledTimes(1);
      expect(newestReads()).toHaveLength(2);
      vi.advanceTimersByTime(60_000);
      loadFoundationShowroom.mockResolvedValue([card(ID(7))]);
      const items = await loadShowroomItems("market", first);
      expect(items.map((item) => item.id)).toEqual([ID(7)]);
      expect(loadFoundationShowroom).toHaveBeenCalledTimes(2);
      expect(newestReads()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the front card on the browser test copy, whose pictures must be stable", async () => {
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
    try {
      loadFoundationShowroom.mockResolvedValue([1, 2, 3].map((n) => card(ID(n))));
      const items = await loadShowroomItems("tourism", () => 0.99);
      expect(items.map((item) => item.id)).toEqual([ID(1), ID(2), ID(3)]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // LIM-APP-showroom-cache: a minute per showroom and area.
  it("remembers the order for a minute per showroom and area", async () => {
    vi.useFakeTimers();
    try {
      resolveIpGeolocation.mockReturnValue({
        country: "ZA",
        regionCode: "GP",
        province: "Gauteng",
        city: "Pretoria",
      });
      loadFoundationShowroom.mockResolvedValue([card(ID(1))]);
      await loadShowroomItems("business", first);
      await loadShowroomItems("business", first);
      expect(loadFoundationShowroom).toHaveBeenCalledTimes(1);
      await loadShowroomItems("home", first);
      expect(loadFoundationShowroom).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(60_000);
      await loadShowroomItems("business", first);
      expect(loadFoundationShowroom).toHaveBeenCalledTimes(3);
      // A card's presentation is remembered for a minute per post, across
      // showrooms: read for business, reused for home, read again after a minute.
      expect(searchFoundationPresentedCards).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the newest posts when the fair order fails", async () => {
    loadFoundationShowroom.mockRejectedValue(new Error("Synthetic timeout"));
    searchFoundationPresentedCards.mockResolvedValue({ items: [card(ID(5))] });
    const items = await loadShowroomItems("tourism", first);
    expect(items.map((item) => item.id)).toEqual([ID(5)]);
    expect(searchFoundationPresentedCards).toHaveBeenCalledWith(
      {},
      { limit: 7, area: "tourism_events" }
    );
  });

  it("keeps a failed showroom from crashing the page", async () => {
    loadFoundationShowroom.mockRejectedValue(new Error("Synthetic timeout"));
    searchFoundationPresentedCards.mockRejectedValue(new Error("Synthetic timeout"));
    await expect(loadShowroomItems("home", first)).resolves.toEqual([]);
    expect(searchFoundationPresentedCards).toHaveBeenCalledWith({}, { limit: 15 });
  });

  it("shows a video-only post's chosen frame as its poster", async () => {
    resolveIpGeolocation.mockReturnValue(onlyIn("Free State"));
    const videoOnly = { image_key: null, video_key: KEY(1) };
    loadFoundationShowroom.mockResolvedValue([card(ID(1), { preview: videoOnly })]);
    searchFoundationPresentedCards.mockResolvedValue({
      items: [presented(ID(1), [{ purpose: "poster", key: KEY(2) }], { preview: videoOnly })],
    });
    const [item] = await loadShowroomItems("tourism", first);
    expect(item).toMatchObject({
      mediaUrl: `/media/${KEY(1)}`,
      mediaKind: "video",
      posterUrl: `/media/${KEY(2)}`,
    });
    expect(item).not.toHaveProperty("logoUrl");
  });

  it("adds the post's logo and keeps its preview picture as the poster", async () => {
    resolveIpGeolocation.mockReturnValue(onlyIn("Limpopo"));
    loadFoundationShowroom.mockResolvedValue([card(ID(1))]);
    searchFoundationPresentedCards.mockResolvedValue({
      items: [
        presented(ID(1), [
          { purpose: "logo", key: KEY(3) },
          { purpose: "poster", key: KEY(4) },
        ]),
      ],
    });
    const [item] = await loadShowroomItems("business", first);
    expect(item).toMatchObject({ posterUrl: "/media/img.jpg", logoUrl: `/media/${KEY(3)}` });
  });

  it("gives the newest posts their chosen frame and logo too", async () => {
    resolveIpGeolocation.mockReturnValue(onlyIn("Mpumalanga"));
    loadFoundationShowroom.mockRejectedValue(new Error("Synthetic timeout"));
    searchFoundationPresentedCards.mockResolvedValue({
      items: [
        presented(
          ID(8),
          [
            { purpose: "poster", key: KEY(5) },
            { purpose: "logo", key: KEY(6) },
          ],
          { preview: { image_key: null, video_key: KEY(7) } }
        ),
      ],
    });
    const [item] = await loadShowroomItems("market", first);
    expect(item).toMatchObject({ posterUrl: `/media/${KEY(5)}`, logoUrl: `/media/${KEY(6)}` });
  });

  it("leaves a post with neither as before, also when its presentation read fails", async () => {
    resolveIpGeolocation.mockReturnValue(onlyIn("North West"));
    const videoOnly = { image_key: null, video_key: KEY(1) };
    loadFoundationShowroom.mockResolvedValue([
      card(ID(1), { preview: videoOnly }),
      card(ID(2), { preview: videoOnly }),
      card(ID(3)),
    ]);
    searchFoundationPresentedCards.mockImplementation(async (_api, input: { post_id?: string }) => {
      if (input.post_id === ID(2)) throw new Error("Synthetic timeout");
      return { items: [presented(input.post_id ?? ID(9), [])] };
    });
    const items = await loadShowroomItems("home", first);
    expect(items.map((item) => item.id)).toEqual([ID(1), ID(2), ID(3)]);
    expect(items.map((item) => item.posterUrl)).toEqual([undefined, undefined, "/media/img.jpg"]);
    for (const item of items) expect(item).not.toHaveProperty("logoUrl");
    expect(newestReads()).toHaveLength(0);
    // One summary warning for the visit, not one per card.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("presentations unavailable"),
      expect.objectContaining({ surface: "home", cards: 3, failed: 1, late: 0 })
    );
  });

  it("stops waiting for a slow presentation read after 1.5 s and remembers its late answer", async () => {
    vi.useFakeTimers();
    try {
      resolveIpGeolocation.mockReturnValue(onlyIn("Limpopo"));
      const videoOnly = { image_key: null, video_key: KEY(1) };
      loadFoundationShowroom.mockResolvedValue([
        card(ID(1), { preview: videoOnly }),
        card(ID(2), { preview: videoOnly }),
      ]);
      const frame = (id: string, key: string) => ({
        items: [presented(id, [{ purpose: "poster", key }])],
      });
      searchFoundationPresentedCards.mockImplementation(
        (_api: unknown, input: { post_id: string }) =>
          input.post_id === ID(1)
            ? new Promise((resolve) => setTimeout(() => resolve(frame(ID(1), KEY(3))), 10_000))
            : Promise.resolve(frame(ID(2), KEY(4)))
      );
      let done = false;
      const visit = loadShowroomItems("tourism", first).then((items) => {
        done = true;
        return items;
      });
      await vi.advanceTimersByTimeAsync(1_499);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const items = await visit;
      // The slow card looks as it does today; the other has its chosen frame.
      expect(items.map((item) => item.posterUrl)).toEqual([undefined, `/media/${KEY(4)}`]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("presentations unavailable"),
        expect.objectContaining({ cards: 2, failed: 0, late: 1 })
      );
      // The late answer is remembered: the next visit shows it without reading again.
      await vi.advanceTimersByTimeAsync(10_000);
      const next = await loadShowroomItems("tourism", first);
      expect(next.map((item) => item.posterUrl)).toEqual([`/media/${KEY(3)}`, `/media/${KEY(4)}`]);
      expect(searchFoundationPresentedCards).toHaveBeenCalledTimes(2);
      expect(loadFoundationShowroom).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives simultaneous misses each their own order read", async () => {
    resolveIpGeolocation.mockReturnValue(onlyIn("Limpopo"));
    let release: (cards: unknown[]) => void = () => {};
    loadFoundationShowroom.mockReturnValue(new Promise((resolve) => (release = resolve)));
    searchFoundationPresentedCards.mockImplementation(
      async (_api: unknown, input: { post_id: string }) => ({
        items: [presented(input.post_id, [{ purpose: "logo", key: KEY(5) }])],
      })
    );
    const visits = [loadShowroomItems("business", first), loadShowroomItems("business", first)];
    release([card(ID(1)), card(ID(2))]);
    const [one, two] = await Promise.all(visits);
    expect(one).toEqual(two);
    expect(one.map((item) => item.logoUrl)).toEqual([`/media/${KEY(5)}`, `/media/${KEY(5)}`]);
    // Nothing is shared between visits, so no visit can wait on another
    // request's read; the minute's cache keeps such misses rare.
    expect(loadFoundationShowroom).toHaveBeenCalledTimes(2);
    // Each visit reads its card presentations itself; duplicates are allowed.
    expect(searchFoundationPresentedCards.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("returns at 1.5 s while another visit's presentation step is stuck", async () => {
    vi.useFakeTimers();
    // The first visit's deadline timer never fires, as when a Worker cancels
    // the request that set it; the second visit must not depend on it.
    const timers = globalThis.setTimeout;
    let dropped = false;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      handler: () => void,
      ms?: number
    ) => {
      if (!dropped && ms === 1_500) {
        dropped = true;
        return timers(() => {}, 1e9);
      }
      return timers(handler, ms);
    }) as typeof setTimeout);
    try {
      resolveIpGeolocation.mockReturnValue(onlyIn("Mpumalanga"));
      const videoOnly = { image_key: null, video_key: KEY(1) };
      loadFoundationShowroom.mockResolvedValue([card(ID(1), { preview: videoOnly })]);
      searchFoundationPresentedCards.mockReturnValue(new Promise(() => {}));
      let stuckDone = false;
      void loadShowroomItems("home", first).then(() => (stuckDone = true));
      await vi.advanceTimersByTimeAsync(100);
      let done = false;
      const visit = loadShowroomItems("home", first).then((items) => {
        done = true;
        return items;
      });
      await vi.advanceTimersByTimeAsync(1_499);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const items = await visit;
      expect(items.map((item) => item.posterUrl)).toEqual([undefined]);
      expect(stuckDone).toBe(false);
      expect(loadFoundationShowroom).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("ignores a presentation reply for another post", async () => {
    const videoOnly = { image_key: null, video_key: KEY(1) };
    loadFoundationShowroom.mockResolvedValue([card(ID(1), { preview: videoOnly })]);
    searchFoundationPresentedCards.mockResolvedValue({
      items: [
        presented(ID(9), [
          { purpose: "poster", key: KEY(2) },
          { purpose: "logo", key: KEY(3) },
        ]),
      ],
    });
    const [item] = await loadShowroomItems("market", first);
    expect(item!.posterUrl).toBeUndefined();
    expect(item).not.toHaveProperty("logoUrl");
  });
});
