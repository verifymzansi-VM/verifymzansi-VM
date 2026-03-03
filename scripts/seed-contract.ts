export type SeedPlanContractRow = {
  area: "MZANSI_MARKET" | "BUSINESS_ADS" | "MALL_SHOPS" | "MZANSI_BUSINESS" | "PROMOTIONS_EVENTS";
  tier: "starter" | "growth" | "pro";
  name: string;
  price_cents: number;
  billing_frequency: "monthly";
  active: true;
};

export const SEED_CONTRACT_VERSION = "2026-02-24";

export const EXPECTED_ACTIVE_PLAN_ROWS: SeedPlanContractRow[] = [
  {
    area: "MZANSI_MARKET",
    tier: "starter",
    name: "Mzansi Market Starter",
    price_cents: 10000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "MZANSI_MARKET",
    tier: "growth",
    name: "Mzansi Market Growth",
    price_cents: 25000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "MZANSI_MARKET",
    tier: "pro",
    name: "Mzansi Market Pro",
    price_cents: 65000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "BUSINESS_ADS",
    tier: "starter",
    name: "Business Ads Starter",
    price_cents: 15000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "BUSINESS_ADS",
    tier: "growth",
    name: "Business Ads Growth",
    price_cents: 40000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "BUSINESS_ADS",
    tier: "pro",
    name: "Business Ads Pro",
    price_cents: 100000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "MALL_SHOPS",
    tier: "starter",
    name: "Mall Shops Starter",
    price_cents: 20000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "MALL_SHOPS",
    tier: "growth",
    name: "Mall Shops Growth",
    price_cents: 50000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "MALL_SHOPS",
    tier: "pro",
    name: "Mall Shops Pro",
    price_cents: 120000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "MZANSI_BUSINESS",
    tier: "starter",
    name: "Mzansi Business Starter",
    price_cents: 15000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "MZANSI_BUSINESS",
    tier: "growth",
    name: "Mzansi Business Growth",
    price_cents: 40000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "MZANSI_BUSINESS",
    tier: "pro",
    name: "Mzansi Business Pro",
    price_cents: 100000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "PROMOTIONS_EVENTS",
    tier: "starter",
    name: "Promotions Starter",
    price_cents: 10000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "PROMOTIONS_EVENTS",
    tier: "growth",
    name: "Promotions Growth",
    price_cents: 25000,
    billing_frequency: "monthly",
    active: true,
  },
  {
    area: "PROMOTIONS_EVENTS",
    tier: "pro",
    name: "Promotions Pro",
    price_cents: 65000,
    billing_frequency: "monthly",
    active: true,
  },
];

export const EXPECTED_FEATURE_FLAG_KEYS = [
  "kyc_v2_flow",
  "kyc_gps_location",
  "kyc_evidence_desk",
] as const;

export function getPlanContractKey(row: Pick<SeedPlanContractRow, "area" | "tier">): string {
  return `${row.area}:${row.tier}`;
}
