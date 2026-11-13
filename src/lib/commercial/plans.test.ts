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
it("serves the Individual slot's one plan in every section, at the database's prices", () => {
  const ids = ["30", "90", "180"].map(
    (days) => `bbbbbbbb-bbbb-4bbb-8bbb-${days.padStart(12, "0")}`
  );
  const result = buildFoundationCommercialCatalog({
    plans: [30, 90, 180].map((days, index) => ({
      id: ids[index],
      code: `individual_${days}d`,
      label: `Individual slot — ${days} days`,
      area: null,
      price_cents: String(6900 * (days / 30)),
      currency: "ZAR",
      duration_days: days,
      activation_period_days: 30,
      activations_per_period: 4,
      slot_capacity: 1,
      max_photos: 10,
      max_videos: 1,
      addon_capabilities: [],
    })),
    addons: [],
  });
  expect(result.retail.map((offer) => [offer.durationDays, offer.priceCents])).toEqual([
    [30, 6900],
    [90, 20700],
    [180, 41400],
  ]);
  result.retail.forEach((offer, index) =>
    expect(offer.planIds).toEqual({
      MZANSI_MARKET: ids[index],
      MZANSI_BUSINESS: ids[index],
      PROMOTIONS_EVENTS: ids[index],
    })
  );
  // No multi-listing plan comes from an Individual slot.
  expect(result.enterprise.every((plan) => plan.planId === null)).toBe(true);
});
