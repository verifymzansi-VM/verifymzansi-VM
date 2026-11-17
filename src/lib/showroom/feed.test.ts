import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchFoundationCards } = vi.hoisted(() => ({ searchFoundationCards: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: () => ({}) }));
vi.mock("@/lib/foundation/public-cards", () => ({
  searchFoundationCards,
  foundationMediaUrl: (key: string | null) => (key ? `/media/${key}` : null),
}));
vi.mock("@/lib/utils/logger", () => ({ createLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));

import { loadShowroomItems } from "./feed";

const card = {
  id: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
  kind: "listing",
  area: "market",
  title: "Bicycle",
  summary: "Barely used",
  locality: "Durban",
  price_cents: 125000,
  preview: { image_key: "img.jpg", video_key: null },
};

describe("loadShowroomItems", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps a failed showroom from crashing the page", async () => {
    searchFoundationCards.mockRejectedValue(new Error("Synthetic timeout"));
    await expect(loadShowroomItems("home")).resolves.toEqual([]);
    expect(searchFoundationCards).toHaveBeenCalledWith({}, { limit: 15 });
  });

  it("asks for the area's cards and presents them as carousel items", async () => {
    searchFoundationCards.mockResolvedValue({ items: [card] });
    await expect(loadShowroomItems("market")).resolves.toEqual([
      {
        id: card.id,
        type: "listing",
        href: `/listing/${card.id}`,
        title: "Bicycle",
        description: "Barely used",
        location: "Durban",
        mediaUrl: "/media/img.jpg",
        mediaKind: "image",
        posterUrl: "/media/img.jpg",
        price: 1250,
      },
    ]);
    expect(searchFoundationCards).toHaveBeenCalledWith({}, { limit: 7, area: "market" });

    await loadShowroomItems("tourism");
    expect(searchFoundationCards).toHaveBeenLastCalledWith(
      {},
      { limit: 7, area: "tourism_events" }
    );
  });
});
