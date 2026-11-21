/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { FoundationPublicApi } from "./public-api";

const switches = vi.hoisted(() => ({ storefront: true }));
vi.mock("../hidden-features", () => ({
  get SHOW_BUSINESS_STOREFRONT() {
    return switches.storefront;
  },
  SHOW_ENGAGEMENT_TOTALS: false,
}));

const { readFoundationStorefront } = await import("./storefront");
const { MarketplaceQueryError, readRestoredCollection } = await import("./marketplace-read");

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const apiWith = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as FoundationPublicApi;
const summary = {
  business_id: BUSINESS,
  business_name: "Sample Motors",
  listings: 18,
  categories: { vehicles: 17, property: 1 },
  makes: ["Toyota", "Volkswagen"],
  areas: [{ province: "kzn", city: "kzn_richards_bay" }],
};
const emptyPage = {
  items: [],
  total: 0,
  next_cursor: null,
  sort: "newest",
  facets: { categories: {} },
  presentation_contract: "restored-public-v1",
};

describe("api.get_public_storefront", () => {
  it("reads a storefront for a post and gives it the page's names", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: summary, error: null });
    await expect(readFoundationStorefront(apiWith(rpc), BUSINESS)).resolves.toEqual({
      businessId: BUSINESS,
      businessName: "Sample Motors",
      listings: 18,
      categories: { vehicles: 17, property: 1 },
      makes: ["Toyota", "Volkswagen"],
      areas: [{ province: "kzn", city: "kzn_richards_bay" }],
    });
    expect(rpc).toHaveBeenCalledWith("get_public_storefront", { p_post_id: BUSINESS });
  });

  it("is null for a post without one, and fails on an error or an unexpected answer", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: null });
    await expect(readFoundationStorefront(apiWith(rpc), BUSINESS)).resolves.toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(readFoundationStorefront(apiWith(rpc), BUSINESS)).rejects.toThrow(
      "Storefront could not be loaded"
    );
    // A field outside the contract (for example an owner id) is refused.
    rpc.mockResolvedValueOnce({ data: { ...summary, owner_id: BUSINESS }, error: null });
    await expect(readFoundationStorefront(apiWith(rpc), BUSINESS)).rejects.toThrow();
  });
});

describe("the storefront filters of /api/listings", () => {
  it("sends the storefront, the make and number ranges to search", async () => {
    switches.storefront = true;
    const rpc = vi.fn().mockResolvedValue({ data: emptyPage, error: null });
    await readRestoredCollection(
      apiWith(rpc),
      "listings",
      new URLSearchParams({
        storefront: BUSINESS,
        make: "Toyota",
        category: "vehicles",
        attr_year_min: "2019",
        attr_transmission: "manual",
        maxPrice: "300000",
        sort: "newest",
      })
    );
    expect(rpc.mock.calls[0]?.[1].p_request).toMatchObject({
      area: "market",
      storefront: BUSINESS,
      make: "Toyota",
      category: "vehicles",
      attributes: { year: { min: 2019 }, transmission: "manual" },
      max_price_cents: 30000000,
      price_mode: "amount",
      sort: "newest",
    });
  });

  it("refuses a malformed storefront, a make without one, and both while switched off", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: emptyPage, error: null });
    const read = (params: Record<string, string>) =>
      readRestoredCollection(apiWith(rpc), "listings", new URLSearchParams(params));
    switches.storefront = true;
    await expect(read({ storefront: "not-a-uuid" })).rejects.toBeInstanceOf(MarketplaceQueryError);
    await expect(read({ make: "Toyota" })).rejects.toBeInstanceOf(MarketplaceQueryError);
    switches.storefront = false;
    await expect(read({ storefront: BUSINESS })).rejects.toBeInstanceOf(MarketplaceQueryError);
    expect(rpc).not.toHaveBeenCalled();
    switches.storefront = true;
  });

  it("refuses a bad make or range before it reaches the database (400, not 503)", async () => {
    switches.storefront = true;
    const rpc = vi.fn().mockResolvedValue({ data: emptyPage, error: null });
    const read = (params: Record<string, string>) =>
      readRestoredCollection(
        apiWith(rpc),
        "listings",
        new URLSearchParams({ storefront: BUSINESS, ...params })
      );
    const cases: Array<Record<string, string>> = [
      { make: "" },
      { make: "   " },
      { make: "Toy\u0000ota" },
      { make: "Toy\nota" },
      { make: "x".repeat(81) },
      { category: "vehicles", attr_year: "2019", attr_year_min: "2018" },
      { category: "vehicles", attr_year_min: "2018", attr_year: "2019" },
      { category: "vehicles", attr_year_min: "1234567890" },
      { category: "vehicles", attr_year_max: "-1" },
    ];
    for (const params of cases)
      await expect(read(params), JSON.stringify(params)).rejects.toBeInstanceOf(
        MarketplaceQueryError
      );
    expect(rpc).not.toHaveBeenCalled();
    await read({ make: "x".repeat(80) });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("leaves attr_<field>_min as an ordinary attribute while switched off", async () => {
    switches.storefront = false;
    const rpc = vi.fn().mockResolvedValue({ data: emptyPage, error: null });
    await readRestoredCollection(
      apiWith(rpc),
      "listings",
      new URLSearchParams({ category: "vehicles", attr_year_min: "1234567890" })
    );
    expect(rpc.mock.calls[0]?.[1].p_request.attributes).toEqual({ year_min: "1234567890" });
    switches.storefront = true;
  });
});
