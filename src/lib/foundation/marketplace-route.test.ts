/** @vitest-environment node */
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { rpc, rate } = vi.hoisted(() => ({
  rpc: vi.fn(),
  rate: vi.fn(() => ({ limited: false, retryAfter: 0 })),
}));
vi.mock("./server-public", () => ({ foundationServerPublicApi: () => ({ rpc }) }));
vi.mock("../utils/rate-limit", () => ({ getClientIp: () => "fixture", checkLocalRateLimit: rate }));
import { restoredMarketplaceResponse } from "./marketplace-route";
afterEach(() => vi.clearAllMocks());
it("serves the original grids' response contracts using the public API schema", async () => {
  rpc.mockResolvedValue({
    data: {
      items: [],
      total: 0,
      next_cursor: null,
      sort: "newest",
      facets: { categories: {} },
      presentation_contract: "restored-public-v1",
    },
    error: null,
  });
  for (const collection of ["listings", "businesses", "promotions"] as const) {
    const response = await restoredMarketplaceResponse(
      new NextRequest(`http://localhost/api/${collection}`),
      collection
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ [collection]: [], total: 0, page: 1, limit: 24 });
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
  expect(rpc.mock.calls.every(([name]) => name === "search_post_cards")).toBe(true);
});
it("returns a retryable error rather than claiming failed reads are empty", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "private diagnostic" } });
  const response = await restoredMarketplaceResponse(
    new NextRequest("http://localhost/api/listings"),
    "listings"
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private diagnostic");
});
it("validates invalid requests without making a database request", async () => {
  const response = await restoredMarketplaceResponse(
    new NextRequest("http://localhost/api/listings?page=0"),
    "listings"
  );
  expect(response.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it("preserves the public read rate limit", async () => {
  rate.mockReturnValueOnce({ limited: true, retryAfter: 12 });
  const response = await restoredMarketplaceResponse(
    new NextRequest("http://localhost/api/listings"),
    "listings"
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("12");
  expect(rpc).not.toHaveBeenCalled();
});
