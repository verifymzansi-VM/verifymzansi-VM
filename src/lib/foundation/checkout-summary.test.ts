import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFoundationCheckoutSummary } from "./checkout-summary";
import { readFoundationBillingCatalogue } from "./billing-catalogue";

vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: vi.fn(() => ({})) }));
vi.mock("./public-api", () => ({ createFoundationPublicApi: vi.fn(() => ({})) }));
vi.mock("./billing-catalogue", () => ({ readFoundationBillingCatalogue: vi.fn() }));

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

  it.each([
    ["an unknown plan", [plan({ id: "00000000-0000-4000-8000-000000000009" })]],
    ["a plan without the 30-day activation period", [plan({ activation_period_days: 7 })]],
    ["a plan without an activation limit", [plan({ activations_per_period: undefined })]],
  ])("refuses %s instead of hiding purchase limits", async (_label, plans) => {
    vi.mocked(readFoundationBillingCatalogue).mockResolvedValueOnce(catalogue(plans));
    await expect(readFoundationCheckoutSummary(planId)).resolves.toBeNull();
  });
});
