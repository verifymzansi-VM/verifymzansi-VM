import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFoundationCheckoutSummary } from "./checkout-summary";
import { readFoundationBillingCatalogue } from "./billing-catalogue";
import type * as BillingCatalogue from "./billing-catalogue";

vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: vi.fn(() => ({})) }));
vi.mock("./public-api", () => ({ createFoundationPublicApi: vi.fn(() => ({})) }));
vi.mock("./billing-catalogue", async (importOriginal) => ({
  ...(await importOriginal<typeof BillingCatalogue>()),
  readFoundationBillingCatalogue: vi.fn(),
}));

const planId = "00000000-0000-4000-8000-000000000002";
const plan = (overrides: Record<string, unknown> = {}) => ({
  id: planId,
  code: "business_30d",
  label: "Business 30 days",
  area: "business",
  price_cents: "5000",
  currency: "ZAR",
  duration_days: 30,
  slot_capacity: 1,
  activation_period_days: 30,
  activations_per_period: 3,
  ...overrides,
});
const catalogue = (plans: unknown[]) => ({ plans, addons: [] }) as never;

beforeEach(() => vi.clearAllMocks());

describe("readFoundationCheckoutSummary", () => {
  it("summarises a single-slot plan from the public catalogue", async () => {
    vi.mocked(readFoundationBillingCatalogue).mockResolvedValueOnce(catalogue([plan()]));
    await expect(readFoundationCheckoutSummary(planId)).resolves.toMatchObject({
      planId,
      name: "Business 30 days",
      areaLabel: "Mzansi Business",
      priceCents: 5000,
      durationDays: 30,
      slotCapacity: 1,
      monthlyActivationLimit: 3,
      administrators: null,
    });
  });

  it("labels an all-sections plan and includes administrators for several slots", async () => {
    vi.mocked(readFoundationBillingCatalogue).mockResolvedValueOnce(
      catalogue([plan({ area: null, slot_capacity: 5 })])
    );
    const summary = await readFoundationCheckoutSummary(planId);
    expect(summary?.areaLabel).toBe("All sections");
    expect(summary?.administrators).not.toBeNull();
  });

  it("offers every Individual slot term to choose from, in any section", async () => {
    const individual = (id: number, days: number) =>
      plan({
        id: `00000000-0000-4000-8000-00000000010${id}`,
        code: `individual_${days}d`,
        label: `Individual slot — ${days} days`,
        area: null,
        price_cents: String(6900 * (days / 30)),
        duration_days: days,
        activations_per_period: 4,
      });
    vi.mocked(readFoundationBillingCatalogue).mockResolvedValueOnce(
      catalogue([individual(3, 180), individual(1, 30), individual(2, 90), plan()])
    );
    const summary = await readFoundationCheckoutSummary("00000000-0000-4000-8000-000000000102");
    expect(summary).toMatchObject({
      planId: "00000000-0000-4000-8000-000000000102",
      areaLabel: "Market, Business or Tourism",
      priceCents: 20700,
      monthlyActivationLimit: 4,
      administrators: null,
    });
    expect(summary?.slotTerms).toEqual([
      {
        planId: "00000000-0000-4000-8000-000000000101",
        label: "Individual slot — 30 days",
        durationDays: 30,
        priceCents: 6900,
      },
      {
        planId: "00000000-0000-4000-8000-000000000102",
        label: "Individual slot — 90 days",
        durationDays: 90,
        priceCents: 20700,
      },
      {
        planId: "00000000-0000-4000-8000-000000000103",
        label: "Individual slot — 180 days",
        durationDays: 180,
        priceCents: 41400,
      },
    ]);
    // A plan for one section is not a slot order.
    vi.mocked(readFoundationBillingCatalogue).mockResolvedValueOnce(catalogue([plan()]));
    expect((await readFoundationCheckoutSummary(planId))?.slotTerms).toBeUndefined();
  });

  it.each([
    ["an unknown plan", [plan({ id: "00000000-0000-4000-8000-000000000009" })]],
    ["a plan without the 30-day activation period", [plan({ activation_period_days: 7 })]],
    ["a plan without an activation limit", [plan({ activations_per_period: undefined })]],
  ])("refuses %s instead of hiding purchase limits", async (_label, plans) => {
    vi.mocked(readFoundationBillingCatalogue).mockResolvedValueOnce(catalogue(plans));
    await expect(readFoundationCheckoutSummary(planId)).resolves.toBeNull();
  });
});
