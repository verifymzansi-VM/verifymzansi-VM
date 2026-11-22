import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchFoundationCards, loadFoundationShowroom, resolveIpGeolocation } = vi.hoisted(() => ({
  searchFoundationCards: vi.fn(),
  loadFoundationShowroom: vi.fn(),
  resolveIpGeolocation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: () => ({}) }));
vi.mock("@/lib/foundation/public-cards", () => ({
  searchFoundationCards,
  loadFoundationShowroom,
  foundationMediaUrl: (key: string | null) => (key ? `/media/${key}` : null),
}));
vi.mock("@/lib/services/ip-geolocation", () => ({ resolveIpGeolocation }));
vi.mock("@/lib/utils/logger", () => ({ createLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));

import { loadShowroomItems, showroomVisitorArea } from "./feed";

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
const first = () => 0;
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
    resolveIpGeolocation.mockImplementation(area);
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
    expect(searchFoundationCards).not.toHaveBeenCalled();
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
      searchFoundationCards.mockResolvedValue({ items: [card(ID(6))] });
      await loadShowroomItems("market", first);
      await loadShowroomItems("market", first);
      expect(loadFoundationShowroom).toHaveBeenCalledTimes(1);
      expect(searchFoundationCards).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(60_000);
      loadFoundationShowroom.mockResolvedValue([card(ID(7))]);
      const items = await loadShowroomItems("market", first);
      expect(items.map((item) => item.id)).toEqual([ID(7)]);
      expect(loadFoundationShowroom).toHaveBeenCalledTimes(2);
      expect(searchFoundationCards).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
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
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the newest posts when the fair order fails", async () => {
    loadFoundationShowroom.mockRejectedValue(new Error("Synthetic timeout"));
    searchFoundationCards.mockResolvedValue({ items: [card(ID(5))] });
    const items = await loadShowroomItems("tourism", first);
    expect(items.map((item) => item.id)).toEqual([ID(5)]);
    expect(searchFoundationCards).toHaveBeenCalledWith({}, { limit: 7, area: "tourism_events" });
  });

  it("keeps a failed showroom from crashing the page", async () => {
    loadFoundationShowroom.mockRejectedValue(new Error("Synthetic timeout"));
    searchFoundationCards.mockRejectedValue(new Error("Synthetic timeout"));
    await expect(loadShowroomItems("home", first)).resolves.toEqual([]);
    expect(searchFoundationCards).toHaveBeenCalledWith({}, { limit: 15 });
  });
});
