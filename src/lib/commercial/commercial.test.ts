import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { mapCommercialError } from "./errors";
import { DEFAULT_COMMERCIAL_SETTINGS, resolveCommercialSettings } from "./settings";
import { buildCommercialCatalog } from "./plans";
import { parsePostingAllowance } from "./allowance";

describe("commercial error mapping", () => {
  it("maps database guard codes to member-facing messages", () => {
    expect(mapCommercialError("SLOT_FULL: All active posting slots")?.status).toBe(409);
    expect(mapCommercialError("TRIAL_REQUIRED: Select an offer")?.status).toBe(402);
    expect(mapCommercialError("AFFILIATION_CONSENT_REQUIRED: Consent")?.status).toBe(400);
    expect(mapCommercialError("Organisation access required")?.status).toBe(403);
    expect(mapCommercialError("An audit reason is required")?.code).toBe("REASON_REQUIRED");
    expect(mapCommercialError("some unrelated failure")).toBeNull();
  });
});

describe("commercial settings", () => {
  it("merges valid rows over defaults and ignores invalid ones", () => {
    const settings = resolveCommercialSettings([
      { key: "partner", value: { commissionBps: 2500 } },
      { key: "events", value: { maxActivePerAccount: -4 } },
      { key: "unknown", value: { anything: true } },
    ]);
    expect(settings.partner.commissionBps).toBe(2500);
    expect(settings.partner.pendingDays).toBe(30);
    expect(settings.events.maxActivePerAccount).toBe(
      DEFAULT_COMMERCIAL_SETTINGS.events.maxActivePerAccount
    );
  });

  it("defaults encode the ceilings every free programme must have", () => {
    expect(DEFAULT_COMMERCIAL_SETTINGS.strategic).toEqual({
      durationDays: 90,
      slotCapacity: 1,
      activationLimitTotal: 3,
    });
    // Document 03 §6: founding packages are exactly 90 days.
    expect(DEFAULT_COMMERCIAL_SETTINGS.founding_commercial).toMatchObject({
      durationDays: 90,
      slotCapacity: 10,
      adminLimit: 2,
    });
    expect(DEFAULT_COMMERCIAL_SETTINGS.founding_organisation).toMatchObject({
      durationDays: 90,
      sponsoredCapacity: 25,
      adminLimit: 3,
    });
    expect(DEFAULT_COMMERCIAL_SETTINGS.extensions.defaultDays).toBe(14);
    expect(DEFAULT_COMMERCIAL_SETTINGS.sponsors.stripMinLive).toBe(5);
    expect(DEFAULT_COMMERCIAL_SETTINGS.partner.commissionBps).toBe(2000);
  });
});

describe("commercial catalogue", () => {
  const retailRow = (area: string, tier: string, price: number) => ({
    id: `${area}-${tier}`,
    area,
    tier,
    name: tier,
    price_cents: price,
    plan_code: null,
    duration_days: tier === "month" ? 30 : tier === "quarter" ? 90 : 180,
    slot_capacity: 1,
    monthly_activation_limit: 10,
    promo_label: null,
    compare_at_cents: null,
    public: true,
    active: true,
  });

  it("uses database prices and ids, keeping defaults for missing rows", () => {
    const catalog = buildCommercialCatalog([
      retailRow("MZANSI_MARKET", "month", 4500),
      retailRow("MZANSI_BUSINESS", "month", 4500),
    ] as never);
    const month = catalog.retail.find((offer) => offer.tier === "month");
    expect(month?.priceCents).toBe(4500);
    expect(month?.planIds.MZANSI_MARKET).toBe("MZANSI_MARKET-month");
    // Area without a row keeps its stable checkout token.
    expect(month?.planIds.PROMOTIONS_EVENTS).toMatch(/^[0-9a-f-]{36}$/);
    expect(catalog.retail.find((offer) => offer.tier === "quarter")?.priceCents).toBe(14000);
    expect(catalog.retail.find((offer) => offer.tier === "half_year")?.durationDays).toBe(180);
    expect(catalog.retail.map((offer) => offer.durationDays)).toEqual([30, 90, 180]);
    // Group 2: 10/25/50/100 slots for 90 and 180 days.
    expect(catalog.enterprise).toHaveLength(8);
    expect(catalog.enterprise[0]).toMatchObject({ planCode: "ENT_10_90D", priceCents: 120000 });
  });

  it("never lists private or inactive plans", () => {
    const hidden = { ...retailRow("MZANSI_MARKET", "month", 100), public: false };
    const catalog = buildCommercialCatalog([hidden] as never);
    expect(catalog.retail.find((offer) => offer.tier === "month")?.priceCents).toBe(5000);
  });
});

describe("posting allowance parsing", () => {
  it("treats malformed RPC data as no paid plan", () => {
    expect(parsePostingAllowance(null)).toMatchObject({ hasPaidPlan: false, capacity: 0 });
    expect(
      parsePostingAllowance({ hasPaidPlan: true, capacity: 25, maxPhotos: 10, maxVideos: 1 })
    ).toMatchObject({ hasPaidPlan: true, capacity: 25 });
  });
});
