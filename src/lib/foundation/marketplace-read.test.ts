/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { FoundationPublicApi } from "./public-api";
import type { FoundationCardPresentation } from "./public-cards";
import {
  MarketplaceQueryError,
  readRestoredCollection,
  restoredPublicRow,
} from "./marketplace-read";
import type * as HiddenFeatures from "@/lib/hidden-features";

// Not about view and like totals: SHOW_ENGAGEMENT_TOTALS is pinned off so no
// totals read is made (that read is tested in post-engagement.test.ts).
// It is on in production (owner's decision of 22 November 2026).
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  SHOW_ENGAGEMENT_TOTALS: false,
}));

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
function card(n = 1, extra = {}) {
  return {
    id: id(n),
    kind: "listing",
    area: "market",
    category: "electronics",
    activity: null,
    title: `Device ${n}`,
    summary: "Public description",
    price_mode: "amount",
    price_cents: String(n * 100),
    price_negotiable: false,
    province: "gp",
    city: "gp_johannesburg",
    locality: "Johannesburg",
    condition: "good",
    published_at: "2026-10-16T10:00:00Z",
    score: null,
    preview: { image_key: `media/${id(n)}`, video_key: null },
    ...extra,
  };
}
const page = (
  items: Array<ReturnType<typeof card> & { presentation?: FoundationCardPresentation }>,
  total = items.length,
  cursor: string | null = null
) => ({
  items: items.map((item) => ({
    ...item,
    presentation: { business_type: null, event_window: null },
    ...("presentation" in item ? { presentation: item.presentation } : {}),
  })),
  total,
  next_cursor: cursor,
  sort: "newest",
  facets: { categories: {} },
  presentation_contract: "restored-public-v1",
});
type Search = { p_request: Record<string, unknown> };
function apiWith(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as FoundationPublicApi;
}

describe("restored marketplace reads", () => {
  it("refuses business contacts on other kinds and inconsistent event metadata", async () => {
    for (const presentation of [
      {
        business_type: null,
        event_window: null,
        frontend: { data: {}, media: [], business_contacts: { phone: "+27700000123" } },
      },
      {
        business_type: null,
        event_window: {
          starts_at: "2026-11-01T10:00:00.000Z",
          ends_at: "2026-11-01T11:00:00.000Z",
          timezone: "Africa/Johannesburg",
        },
      },
    ]) {
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: page([{ ...card(), presentation }]), error: null });
      await expect(readRestoredCollection(apiWith(rpc), "listings")).rejects.toThrow(
        "Invalid public card presentation"
      );
    }
  });
  it("uses approved public card RPCs and maps the original cards without private fields or fabricated badges", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: page([card()]), error: null });
    const result = await readRestoredCollection(apiWith(rpc), "listings");
    expect(rpc).toHaveBeenCalledWith("search_post_cards", {
      p_request: {
        area: "market",
        limit: 24,
        offset: 0,
        presentation: true,
        frontend_presentation: true,
      },
    });
    expect(result.rows[0]).toMatchObject({
      title: "Device 1",
      price_cents: 100,
      location_province: "Gauteng",
      location_city: "Johannesburg",
      photos: [expect.stringContaining(`/media/${id(1)}`)],
    });
    expect(result.rows[0]).not.toHaveProperty("owner_id");
    expect(result.rows[0]).not.toHaveProperty("cipc_verified_at");
    expect(result.rows[0]?.seller).toBeNull();
  });

  it("translates province/city display names and Rand bounds into canonical search filters", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: page([]), error: null });
    await readRestoredCollection(
      apiWith(rpc),
      "listings",
      new URLSearchParams({
        province: "Gauteng",
        city: "Johannesburg",
        minPrice: "10.50",
        maxPrice: "20",
        category: "electronics",
        attr_delivery: "true",
      })
    );
    expect(rpc.mock.calls[0]?.[1].p_request).toMatchObject({
      province: "gp",
      city: "gp_johannesburg",
      min_price_cents: 1050,
      max_price_cents: 2000,
      price_mode: "amount",
      attributes: { delivery: true },
    });
  });

  it("loads page three directly with the server's complete count", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: page(
        Array.from({ length: 22 }, (_, n) => card(n + 49)),
        70
      ),
      error: null,
    });
    const result = await readRestoredCollection(
      apiWith(rpc),
      "listings",
      new URLSearchParams({ page: "3", limit: "24" })
    );
    expect(result.total).toBe(70);
    expect(result.rows).toHaveLength(22);
    expect(result.rows[0]?.id).toBe(id(49));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1].p_request).toMatchObject({ offset: 48, limit: 24 });
  });

  it.each([
    [24, "101", 100, 99 * 24],
    [24, "10000", 100, 99 * 24],
    [50, "100", 96, 95 * 50],
    [12, "150", 100, 99 * 12],
  ])(
    "serves the last page within the search depth at %i a page for page %s",
    async (limit, asked, served, offset) => {
      const rpc = vi.fn().mockResolvedValue({ data: page([], 10_000), error: null });
      const result = await readRestoredCollection(
        apiWith(rpc),
        "listings",
        new URLSearchParams({ page: asked, limit: String(limit) })
      );
      expect(result.page).toBe(served);
      expect(result.total).toBe(10_000);
      expect(rpc.mock.calls[0]?.[1].p_request).toMatchObject({ offset });
      // Every read starts at or before the deepest offset the database serves.
      for (const call of rpc.mock.calls) expect(call[1].p_request.offset).toBeLessThanOrEqual(4800);
    }
  );

  it("reads an organisation's businesses in one filtered, counted read", async () => {
    const rpc = vi.fn(async (name: string, _args: Search) => ({
      data:
        name !== "search_post_cards"
          ? []
          : page(
              [3, 4].map((n) =>
                card(n, {
                  kind: "business",
                  area: "business",
                  category: "general_other",
                  price_mode: null,
                  price_cents: null,
                  condition: null,
                })
              ),
              30
            ),
      error: null,
    }));
    const programme = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
    const result = await readRestoredCollection(
      apiWith(rpc),
      "businesses",
      new URLSearchParams({ org: "example-org", programme, sponsored: "1", page: "2", limit: "24" })
    );
    // Only the stickers read follows the one card read; no affiliation or
    // sponsorship batches, and the database's own total.
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "search_post_cards",
      "get_public_frontend_business_seen",
      "get_public_frontend_business_cipc",
    ]);
    expect(rpc.mock.calls[0]![1].p_request).toMatchObject({
      area: "business",
      organisation: "example-org",
      programme,
      sponsored: true,
      offset: 24,
      limit: 24,
    });
    expect(result).toMatchObject({ total: 30, page: 2, limit: 24 });
    expect(result.rows.map((row) => row.id)).toEqual([id(3), id(4)]);
  });

  it.each([
    [{ org: "Not A Slug" }, "Invalid organisation"],
    [{ org: "example-org", programme: "not-a-uuid" }, "Invalid programme"],
  ])("refuses organisation filters %o before contacting the backend", async (filters, message) => {
    const rpc = vi.fn();
    await expect(
      readRestoredCollection(apiWith(rpc), "businesses", new URLSearchParams(filters))
    ).rejects.toThrow(message);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends programme and sponsored only with an organisation", async () => {
    const rpc = vi.fn(async (_name: string, _args: Search) => ({ data: page([]), error: null }));
    await readRestoredCollection(
      apiWith(rpc),
      "businesses",
      new URLSearchParams({ programme: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", sponsored: "1" })
    );
    const request = rpc.mock.calls[0]![1].p_request;
    expect(request).not.toHaveProperty("programme");
    expect(request).not.toHaveProperty("sponsored");
    expect(request).not.toHaveProperty("organisation");
  });

  it("delegates price sorting before paging to the database", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...page([card(1), card(3)], 3), sort: "price_asc" },
      error: null,
    });
    const result = await readRestoredCollection(
      apiWith(rpc),
      "listings",
      new URLSearchParams({ sort: "price_asc", limit: "2" })
    );
    expect(result.rows.map((row) => row.id)).toEqual([id(1), id(3)]);
    expect(result.total).toBe(3);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1].p_request).toMatchObject({
      sort: "price_asc",
      offset: 0,
      limit: 2,
    });
  });

  it("distinguishes an empty catalogue from a backend failure", async () => {
    expect(
      await readRestoredCollection(
        apiWith(vi.fn().mockResolvedValue({ data: page([]), error: null })),
        "businesses"
      )
    ).toMatchObject({ rows: [], total: 0 });
    await expect(
      readRestoredCollection(
        apiWith(vi.fn().mockResolvedValue({ data: null, error: { message: "down" } })),
        "businesses"
      )
    ).rejects.toThrow("Posts could not be loaded");
  });

  it("rejects malformed filters before contacting the backend", async () => {
    const queries: Record<string, string>[] = [
      { page: "-1" },
      { limit: "999" },
      { minPrice: "NaN" },
      { province: "invalid" },
      { sort: "private" },
      { condition: "private" },
      { minPrice: "20", maxPrice: "10" },
    ];
    for (const query of queries) {
      const rpc = vi.fn();
      await expect(
        readRestoredCollection(apiWith(rpc), "listings", new URLSearchParams(query))
      ).rejects.toBeInstanceOf(MarketplaceQueryError);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("keeps Free separate from a price on request", () => {
    expect(
      restoredPublicRow(card(1, { price_mode: "free", price_cents: "0" }) as never).price_cents
    ).toBe(0);
    expect(
      restoredPublicRow(card(1, { price_mode: "on_request", price_cents: null }) as never)
        .price_cents
    ).toBeNull();
  });

  it("serves fifty viewer cards with two bounded reads", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: page(
          Array.from({ length: 48 }, (_, n) => card(n + 1)),
          100
        ),
        error: null,
      })
      .mockResolvedValueOnce({ data: page([card(49), card(50)], 100), error: null });
    const result = await readRestoredCollection(
      apiWith(rpc),
      "listings",
      new URLSearchParams({ limit: "50" })
    );
    expect(result.rows).toHaveLength(50);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]?.[1].p_request).toMatchObject({ offset: 48, limit: 2 });
  });

  it("retains every ordered video and the approved contact choices", () => {
    const core = card();
    const detail = {
      ...core,
      event_window: null,
      description: "Public",
      contact_channels: ["call", "whatsapp"],
      media: [2, 1].map((n) => ({
        kind: "video",
        purpose: "video",
        position: n - 1,
        object_key: `media/${id(n)}`,
        width: null,
        height: null,
        focal_x: null,
        focal_y: null,
      })),
      seller: { public_name: "Tester T.", identity_verified: true },
    };
    const result = restoredPublicRow(core as never, detail as never);
    expect(result.videos).toEqual([expect.stringContaining(id(1)), expect.stringContaining(id(2))]);
    expect(result.contact_methods).toEqual(["call", "whatsapp"]);
    expect(JSON.stringify(result)).not.toContain("+27");
  });

  it("never puts a business number on a public business row, only which ones Show number can serve", () => {
    const core = card(1, {
      kind: "business",
      area: "business",
      category: "restaurants",
      price_mode: null,
      price_cents: null,
      condition: null,
    });
    const presentation = {
      business_type: "physical",
      event_window: null,
      frontend: {
        data: { website: "https://example.invalid" },
        media: [],
        business_contacts: { phone: "031 123 4567", whatsapp: "0821234567" },
      },
    };
    const result = restoredPublicRow(core as never, undefined, presentation as never);
    expect(result.phone).toBeNull();
    expect(result.whatsapp).toBeNull();
    expect(result.contact_available).toEqual({ phone: true, whatsapp: true, email: false });
    expect(result.website).toBe("https://example.invalid");
    const text = JSON.stringify(result);
    expect(text).not.toContain("1234567");
    expect(text).not.toContain("+27");
    // A Market listing has no business numbers to ask for.
    expect(restoredPublicRow(card() as never).contact_available).toBeUndefined();
  });

  it("filters event dates before pagination and never mixes tourism businesses into events", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-29T12:00:00Z"));
    try {
      const events = [1, 2].map((n) =>
        card(n, {
          kind: "event",
          area: "tourism_events",
          category: "events",
          activity: "market_expo",
          price_mode: null,
          price_cents: null,
          condition: null,
        })
      );
      const details = events.map(
        ({ summary: _summary, preview: _preview, score: _score, ...core }, i) => ({
          ...core,
          description: "Public event",
          visible_until: "2027-01-01T00:00:00Z",
          event_window: {
            starts_at: i === 0 ? "2026-10-01T10:00:00.000Z" : "2026-10-30T10:00:00.000Z",
            ends_at: i === 0 ? "2026-10-01T12:00:00.000Z" : "2026-10-30T12:00:00.000Z",
            timezone: "Africa/Johannesburg",
          },
          media: [],
          seller: { public_name: "Host H.", avatar_object_key: null, identity_verified: true },
        })
      );
      const rpc = vi.fn(async (name: string, args: { p_request: { event_state: string } }) => {
        expect(name).toBe("search_post_cards");
        const index = args.p_request.event_state === "ended" ? 0 : 1;
        return {
          data: page([
            {
              ...events[index]!,
              presentation: { business_type: null, event_window: details[index]!.event_window },
            },
          ]),
          error: null,
        };
      });
      const upcoming = await readRestoredCollection(
        apiWith(rpc),
        "promotions",
        new URLSearchParams({ limit: "1" })
      );
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(upcoming.total).toBe(1);
      expect(upcoming.rows[0]?.id).toBe(id(2));
      expect(upcoming.rows[0]?.start_date).toBe("2026-10-30T10:00:00.000Z");
      const past = await readRestoredCollection(
        apiWith(rpc),
        "promotions",
        new URLSearchParams({ event_state: "ended" })
      );
      expect(past.rows.map((row) => row.id)).toEqual([id(1)]);
      expect(rpc.mock.calls[0]?.[1]).toMatchObject({
        p_request: { area: "tourism_events", category: "events" },
      });
    } finally {
      clock.mockRestore();
    }
  });

  describe("business search includes tourism businesses", () => {
    it("searches every business in one read, in the database's order and depth", async () => {
      const rpc = vi.fn(async (_name: string, _args: Search) => ({
        data: { ...page([], 2400), sort: "relevance" },
        error: null,
      }));
      const result = await readRestoredCollection(
        apiWith(rpc),
        "businesses",
        new URLSearchParams({ q: "lodge", province: "gp", page: "30", limit: "24" })
      );
      expect(rpc).toHaveBeenCalledTimes(1);
      const request = rpc.mock.calls[0]![1].p_request;
      expect(request).toMatchObject({
        kind: "business",
        q: "lodge",
        sort: "relevance",
        province: "gp",
        offset: 29 * 24,
        limit: 24,
      });
      expect(request).not.toHaveProperty("area");
      expect(result.total).toBe(2400);
    });

    it("keeps browsing and category filters to one area", async () => {
      const rpc = vi.fn(async (_name: string, _args: Search) => ({ data: page([]), error: null }));
      await readRestoredCollection(apiWith(rpc), "businesses", new URLSearchParams());
      await readRestoredCollection(
        apiWith(rpc),
        "businesses",
        new URLSearchParams({ q: "lodge", category: "general_other" })
      );
      await readRestoredCollection(
        apiWith(rpc),
        "businesses",
        new URLSearchParams({ q: "lodge", category: "tourism_hospitality" })
      );
      const requests = rpc.mock.calls.map(([, args]) => args.p_request);
      expect(requests.map((request) => request.area)).toEqual([
        "business",
        "business",
        "tourism_events",
      ]);
      expect(requests.some((request) => "kind" in request)).toBe(false);
    });
  });
});
