import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import PricingPage from "@/app/pricing/page";
import BillingPage from "@/app/billing/page";
import {
  ACTIVE_MARKETPLACE_AREAS,
  FREE_POST_CONFIG,
  isActiveMarketplaceArea,
  PLANS,
  type PlanDefinition,
} from "@/lib/constants/pricing";
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

vi.mock("@/components/billing/subscribe-button", () => ({
  SubscribeButton: () => <button type="button">Subscribe</button>,
}));

type DbPlanRow = {
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("plans")
    .select("area, tier, name, price_cents, billing_frequency, features, active")
    .in("area", [...ACTIVE_MARKETPLACE_AREAS])
    .eq("active", true);

  if (error) {
    throw error;
  }

  dbPlans = (data ?? []) as DbPlanRow[];
});

describe("Active-area pricing parity", () => {
  it("pricing and billing pages render only the three active marketplace surfaces", () => {
    render(<PricingPage />);
    expect(screen.getAllByText("Mzansi Market").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mzansi Business").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Promotions & Events").length).toBeGreaterThan(0);
    expect(screen.queryByText("Mall Shops")).not.toBeInTheDocument();
    expect(screen.queryByText("Business Ads")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          `1 free post per area every ${FREE_POST_CONFIG.durationDays} days, with ${FREE_POST_CONFIG.maxPhotos} photos and ${FREE_POST_CONFIG.maxVideos} video`,
          "i"
        )
      )
    ).toBeInTheDocument();
  });

  it("billing page free-post copy matches the runtime free-post configuration", () => {
    render(<BillingPage />);
    expect(
      screen.getByText(
        new RegExp(
          `${FREE_POST_CONFIG.maxPhotos} photos, ${FREE_POST_CONFIG.maxVideos} video, ${FREE_POST_CONFIG.durationDays} days`,
          "i"
        )
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Mall Shops")).not.toBeInTheDocument();
    expect(screen.queryByText("Business Ads")).not.toBeInTheDocument();
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
      expect(entitlements.coverVideoAllowed).toBe(plan.features.coverVideoAllowed);
    }

    if (dbPlans.length === 0) {
      return;
    }

    const dbPlanMap = new Map(dbPlans.map((plan) => [`${plan.area}:${plan.tier}`, plan]));

    for (const runtimePlan of activePlans) {
      const dbPlan = dbPlanMap.get(`${runtimePlan.area}:${runtimePlan.tier}`);
      expect(dbPlan).toBeDefined();
      expect(dbPlan?.name).toBe(runtimePlan.name);
      expect(dbPlan?.price_cents).toBe(runtimePlan.priceCents);
      expect(dbPlan?.billing_frequency).toBe(runtimePlan.billingFrequency);
      expect(dbPlan?.active).toBe(true);
      expect(dbPlan?.features).toMatchObject(runtimePlan.features);
    }
  });
});
