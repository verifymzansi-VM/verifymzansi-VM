/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { FoundationPublicApi } from "./public-api";
import type { FoundationCardPresentation } from "./public-cards";
import {
  MarketplaceQueryError,
  readRestoredCollection,
  restoredPublicRow,
} from "./marketplace-read";

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
function apiWith(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as FoundationPublicApi;
}

describe("restored marketplace reads", () => {
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

  it("applies organisation and sponsorship filters using confirmed public relationships before counting", async () => {
    const businesses = [1, 2].map((n) =>
      card(n, {
        kind: "business",
        area: "business",
        category: "general_other",
        price_mode: null,
        price_cents: null,
        condition: null,
      })
    );
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === "search_post_cards"
          ? page(businesses)
          : name === "public_post_affiliations"
            ? [
                {
                  post_id: id(2),
                  organisation_slug: "local-org",
                  organisation_name: "Local organisation",
                  logo_object_key: null,
                  label: "Member",
                  programme_name: "Local programme",
                  confirmed_at: "2026-10-01T12:00:00Z",
                },
              ]
            : [],
      error: null,
    }));
    const params = new URLSearchParams({ org: "local-org", programme_name: "Local programme" });
    const affiliated = await readRestoredCollection(apiWith(rpc), "businesses", params);
    expect(affiliated.total).toBe(1);
    expect(affiliated.rows.map((row) => row.id)).toEqual([id(2)]);
    params.set("sponsored", "1");
    const sponsored = await readRestoredCollection(apiWith(rpc), "businesses", params);
    expect(sponsored).toMatchObject({ rows: [], total: 0 });
    expect(rpc.mock.calls.map(([name]) => name)).toContain("public_post_sponsorships");
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
});
