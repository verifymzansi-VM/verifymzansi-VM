/** @vitest-environment node */
import { expect, it } from "vitest";
import { buildFoundationCommercialCatalog } from "./plans";
it("uses public replacement-catalogue prices and checkout identities in the existing pricing cards", () => {
  const result = buildFoundationCommercialCatalog({
    plans: ["market", "business", "tourism_events"].map((area, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${index}`,
      code: `${area}_30d`,
      label: "30 Days",
      area: area as "market" | "business" | "tourism_events",
      price_cents: "7300",
      currency: "ZAR",
      duration_days: 30,
      slot_capacity: 1,
      max_photos: 5,
      max_videos: 1,
      addon_capabilities: [],
    })),
    addons: [],
  });
  expect(result.source).toBe("database");
  expect(result.retail[0]?.priceCents).toBe(7300);
  expect(result.retail[0]?.planIds).toEqual({
    MZANSI_MARKET: "aaaaaaaa-aaaa-4aaa-8aaa-000000000000",
    MZANSI_BUSINESS: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    PROMOTIONS_EVENTS: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
  });
});
