import { describe, expect, it, vi } from "vitest";
import {
  applyBaseMarketFilters,
  canRetryListingInsertForCompat,
  createListingSelectAttempts,
  matchesAttributeFilters,
  normalizeListingSelectShape,
  omitListingCompatFields,
} from "@/app/api/listings/_lib/listing-route-helpers";

function createQueryRecorder() {
  const calls: Array<[string, string, unknown, unknown?]> = [];
  const query = {
    eq: vi.fn((column: string, value: unknown) => {
      calls.push(["eq", column, value]);
      return query;
    }),
    gte: vi.fn((column: string, value: number) => {
      calls.push(["gte", column, value]);
      return query;
    }),
    lte: vi.fn((column: string, value: number) => {
      calls.push(["lte", column, value]);
      return query;
    }),
    or: vi.fn((filters: string) => {
      calls.push(["or", filters, undefined]);
      return query;
    }),
    order: vi.fn((column: string, options?: unknown) => {
      calls.push(["order", column, options]);
      return query;
    }),
  };

  return { query, calls };
}

describe("listing route helpers", () => {
  it("builds owner-column aware select fallbacks", () => {
    const attempts = createListingSelectAttempts("seller_id");

    expect(attempts).toHaveLength(10);
    expect(attempts[0].select).toContain("seller_id");
    expect(attempts[0].select).not.toContain("owner_id");
    expect(attempts.at(-1)?.omittedFields).toEqual([
      "featured_until",
      "condition",
      "video_thumbnail",
      "logo_url",
      "view_count",
    ]);
  });

  it("applies safe public marketplace filters and strips query metacharacters", () => {
    const { query, calls } = createQueryRecorder();

    applyBaseMarketFilters(query, {
      category: "vehicles",
      province: "Gauteng",
      city: "Johannesburg",
      condition: "used",
      priceMin: 100.25,
      priceMax: 200,
      query: "Toyota')||true",
      sort: "price_asc",
      attributes: {},
      page: 1,
    } as never);

    expect(calls).toContainEqual(["eq", "category", "vehicles"]);
    expect(calls).toContainEqual(["gte", "price_cents", 10025]);
    expect(calls).toContainEqual(["lte", "price_cents", 20000]);
    expect(query.or).toHaveBeenCalledWith(
      "title.ilike.%Toyotatrue%,description.ilike.%Toyotatrue%"
    );
    expect(query.order).toHaveBeenCalledWith("price_cents", { ascending: true });
  });

  it("matches attribute filters across arrays, booleans, numbers, and strings", () => {
    expect(
      matchesAttributeFilters(
        {
          features: ["abs", "aircon"],
          negotiable: true,
          bedrooms: 3,
          brand: "Toyota Corolla",
        },
        {
          features: ["aircon"],
          negotiable: true,
          bedrooms: "2+",
          brand: "corolla",
        }
      )
    ).toBe(true);

    expect(matchesAttributeFilters({ bedrooms: 1 }, { bedrooms: "2+" })).toBe(false);
  });

  it("normalizes optional select fields and omits compat fields immutably", () => {
    const listing = { id: "1", title: "Live listing", logo_url: "https://example.test/logo.png" };

    expect(normalizeListingSelectShape([listing])[0]).toMatchObject({
      id: "1",
      featured_until: null,
      condition: null,
      video_thumbnail: null,
      view_count: null,
    });

    const omitted = omitListingCompatFields(listing, ["logo_url"]);
    expect(omitted).not.toHaveProperty("logo_url");
    expect(listing).toHaveProperty("logo_url");
  });

  it("identifies retryable schema drift insert errors", () => {
    expect(
      canRetryListingInsertForCompat(
        { code: "42703", message: "column listings.logo_url does not exist" },
        ["logo_url"]
      )
    ).toBe(true);
    expect(
      canRetryListingInsertForCompat({ code: "23505", message: "duplicate key" }, ["logo_url"])
    ).toBe(false);
  });
});
