import { describe, expect, it, vi } from "vitest";
import {
  FoundationPostsUnavailableError,
  loadFoundationShowroom,
  searchFoundationCards,
  searchFoundationPresentedCards,
} from "./public-cards";
import type { FoundationPublicApi } from "./public-api";

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "event",
  area: "tourism_events",
  category: "events",
  activity: "festival",
  title: "Beach market",
  summary: "Crafts and food",
  price_mode: null,
  price_cents: null,
  price_negotiable: false,
  province: "kzn",
  city: "kzn_durban",
  locality: "Durban",
  condition: null,
  published_at: "2026-11-21T08:00:00.123456+00:00",
  is_new: true,
  preview: { image_key: "media/4d5e6f70-8192-4a3b-9c4d-5e6f708192a3", video_key: null },
  ...extra,
});
const ID = (n: number) => `${n}d5e6f70-8192-4a3b-9c4d-5e6f708192a3`;
const api = (data: unknown, error: unknown = null) => {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { api: { rpc } as unknown as FoundationPublicApi, rpc };
};

describe("loadFoundationShowroom", () => {
  it("sends the showroom and area and returns the cards in order", async () => {
    const { api: client, rpc } = api({ items: [card(ID(1)), card(ID(2), { is_new: false })] });
    const cards = await loadFoundationShowroom(client, {
      showroom: "tourism",
      province: "kzn",
      city: "kzn_durban",
    });
    expect(rpc).toHaveBeenCalledWith("showroom_feed", {
      p_request: { showroom: "tourism", province: "kzn", city: "kzn_durban" },
    });
    expect(cards.map((c) => [c.id, c.is_new])).toEqual([
      [ID(1), true],
      [ID(2), false],
    ]);
  });

  it("refuses anything but public card fields, duplicates or more than 15 cards", async () => {
    const bad = [
      { items: [card(ID(1), { owner_id: ID(9) })] },
      { items: [card(ID(1), { score: "1.2" })] },
      { items: [card(ID(1), { is_new: "yes" })] },
      { items: [card(ID(1)), card(ID(1))] },
      { items: Array.from({ length: 16 }, (_, n) => card(`${n.toString(16)}${ID(0).slice(1)}`)) },
      { items: [], total: 0 },
      null,
    ];
    for (const data of bad)
      await expect(loadFoundationShowroom(api(data).api, { showroom: "home" })).rejects.toThrow();
    await expect(
      loadFoundationShowroom(api(null, { message: "down" }).api, { showroom: "home" })
    ).rejects.toThrow("Showroom could not be loaded");
  });
});

describe("card search failures", () => {
  it("marks a failed database read apart from a refused reply", async () => {
    for (const search of [searchFoundationCards, searchFoundationPresentedCards]) {
      const down = search(api(null, { message: "down" }).api, { limit: 7 });
      await expect(down).rejects.toBeInstanceOf(FoundationPostsUnavailableError);
      await expect(down).rejects.toThrow("Posts could not be loaded");
      const refused = search(api({ items: "not a list" }).api, { limit: 7 });
      await expect(refused).rejects.toThrow();
      await expect(refused).rejects.not.toBeInstanceOf(FoundationPostsUnavailableError);
    }
  });
});
