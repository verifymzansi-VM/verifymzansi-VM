import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import PricingPage from "@/app/pricing/page";
import BillingPage from "@/app/billing/page";
import {
  ACTIVE_MARKETPLACE_AREAS,
  isActiveMarketplaceArea,
  PLANS,
  type PlanDefinition,
} from "@/lib/constants/pricing";
import { getStablePlanId } from "@/lib/constants/plan-ids";
import { getActivePlanSelectionFromToken } from "@/lib/billing/plan-resolver";
import { getEntitlements } from "@/lib/services/entitlements";

vi.mock("next/navigation", () => ({
  usePathname: () => "/pricing",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="mock-header" />,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="mock-footer" />,
}));

vi.mock("server-only", () => ({}));
// Pages read the plans table through the admin client; unit tests use the
// seeded defaults (the live-DB comparison below is opt-in).
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("No database in unit tests");
  },
}));

type DbPlanRow = {
  id: string;
  area: PlanDefinition["area"];
  tier: PlanDefinition["tier"];
  name: string;
  price_cents: number;
  billing_frequency: string;
  features: Record<string, unknown>;
  active: boolean;
};

let dbPlans: DbPlanRow[] = [];

beforeAll(async () => {
  if (process.env.LIVE_PLAN_PARITY_DB !== "true") {
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  try {
    // Keep this test deterministic when CI or local env provides a non-URL placeholder.
    new URL(supabaseUrl);
  } catch {
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("plans")
    .select("id, area, tier, name, price_cents, billing_frequency, features, active")
    .in("area", [...ACTIVE_MARKETPLACE_AREAS])
    .eq("active", true);

  if (error) {
    throw error;
  }

  dbPlans = (data ?? []) as DbPlanRow[];
});

describe("Active-area pricing parity", () => {
  it("pricing page shows the R50 / R250 / R450 ladder, free events and the organisation route", async () => {
    render(await PricingPage());
    const radios = screen
      .getAllByRole("radio")
      .map((radio) => radio.textContent?.replace(/\s+/g, " ").trim());
    expect(radios).toHaveLength(3);
    expect(screen.getByTestId("retail-offer-month")).toHaveTextContent("R50");
    expect(screen.getByTestId("retail-offer-half_year")).toHaveTextContent("R250");
    expect(screen.getByTestId("retail-offer-half_year")).toHaveTextContent("Most popular");
    expect(screen.getByTestId("retail-offer-half_year")).toHaveTextContent("Save R50");
    expect(screen.getByTestId("retail-offer-year")).toHaveTextContent("R450");
    expect(screen.getByTestId("retail-offer-year")).toHaveTextContent("Best value");
    expect(screen.getByTestId("retail-offer-year")).toHaveTextContent("Save R150");
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /request a proposal/i })).toHaveAttribute(
      "href",
      "/contact?topic=organisation_proposal"
    );
    expect(screen.queryByText(/R650|R30 /)).not.toBeInTheDocument();
    expect(screen.queryByText("Mall Shops")).not.toBeInTheDocument();
    const planLinks = screen.getAllByRole("link", {
      name: /Choose .*(30 Days|6 Months|12 Months)/i,
    });
    expect(planLinks).toHaveLength(3);
    expect(
      planLinks.every((link) => link.getAttribute("href")?.startsWith("/billing/checkout?plan="))
    ).toBe(true);
  });

  it("billing page keeps the introductory trial copy", async () => {
    render(await BillingPage());
    expect(
      screen.getByText(/One introductory choice: 7 days or limited 30 days/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Strategic, founding partner and organisation-sponsored/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Mall Shops")).not.toBeInTheDocument();
  });

  it("runtime active plans stay aligned with entitlements and the live plans table", () => {
    const activePlans = PLANS.filter((plan) => isActiveMarketplaceArea(plan.area));

    for (const plan of activePlans) {
      const entitlements = getEntitlements(plan.tier, plan.area);
      expect(entitlements.maxPhotos).toBe(plan.features.maxPhotos);
      expect(entitlements.maxVideos).toBe(plan.features.maxVideos ?? 0);
      expect(entitlements.maxPostsPerMonth).toBe(plan.features.maxPostsPerMonth);
      expect(entitlements.videoAllowed).toBe(plan.features.videoAllowed);
      expect(entitlements.boostAllowed).toBe(plan.features.boostAllowed);
      expect(entitlements.featuredAllowed).toBe(plan.features.featuredAllowed);
      expect(entitlements.urgentAllowed).toBe(plan.features.urgentAllowed);
    }

    if (dbPlans.length === 0) {
      return;
    }

    const dbPlanMap = new Map(dbPlans.map((plan) => [`${plan.area}:${plan.tier}`, plan]));

    for (const runtimePlan of activePlans) {
      const dbPlan = dbPlanMap.get(`${runtimePlan.area}:${runtimePlan.tier}`);
      const stableToken = getStablePlanId(runtimePlan.area, runtimePlan.tier);
      expect(dbPlan).toBeDefined();
      expect(getActivePlanSelectionFromToken(stableToken)).toMatchObject({
        area: runtimePlan.area,
        tier: runtimePlan.tier,
      });
      expect(dbPlan?.id).toEqual(expect.any(String));
      expect(dbPlan?.name).toBe(runtimePlan.name);
      expect(dbPlan?.price_cents).toBe(runtimePlan.priceCents);
      expect(dbPlan?.billing_frequency).toBe(runtimePlan.billingFrequency);
      expect(dbPlan?.active).toBe(true);
      expect(dbPlan?.features).toMatchObject(runtimePlan.features);
    }
  });
});
