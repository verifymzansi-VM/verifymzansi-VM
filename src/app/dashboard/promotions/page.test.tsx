import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PromotionsPage from "@/app/dashboard/promotions/page";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/account/compat", () => ({
  applyOwnerFilter: vi.fn((query) => query),
  getOwnerColumn: vi.fn().mockResolvedValue("owner_id"),
}));

vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: vi.fn().mockResolvedValue("starter"),
}));

vi.mock("@/lib/services/entitlements", () => ({
  canBoost: vi.fn().mockReturnValue({ allowed: true }),
  canFeatured: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock("@/components/listings/boost-button", () => ({
  BoostButton: () => <button type="button">Boost</button>,
}));

vi.mock("@/components/listings/featured-button", () => ({
  FeaturedButton: () => <button type="button">Featured</button>,
}));

vi.mock("@/components/listings/resubmit-button", () => ({
  ResubmitButton: () => <button type="button">Resubmit</button>,
}));

vi.mock("@/components/listings/delete-post-button", () => ({
  DeletePostButton: () => <button type="button">Delete</button>,
}));

function createThenableQuery(data: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data }),
  };

  return builder;
}

describe("Dashboard promotions page", () => {
  const mockSupabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>
    );
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("shows rejected promotions with a rejection reason and recovery actions", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "promotions") {
        return createThenableQuery([
          {
            id: "promo-1",
            title: "Weekend Sale",
            promotion_type: "deal",
            business_id: null,
            status: "rejected",
            status_reason: "Update the event dates before resubmitting.",
            boost_until: null,
            featured_until: null,
            created_at: "2026-03-01T00:00:00.000Z",
          },
        ]);
      }

      if (table === "listings" || table === "businesses") {
        return createThenableQuery([]);
      }

      return createThenableQuery([]);
    });

    const ui = await PromotionsPage();
    render(ui);

    expect(screen.getByText(/Weekend Sale/i)).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText(/Reason for rejection/i)).toBeInTheDocument();
    expect(screen.getByText(/Update the event dates before resubmitting\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resubmit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create Promotion/i })).toHaveAttribute(
      "href",
      "/post/create-promotion"
    );
  });

  it("surfaces a success banner after creating a promotion", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "promotions" || table === "listings" || table === "businesses") {
        return createThenableQuery([]);
      }

      return createThenableQuery([]);
    });

    const ui = await PromotionsPage({ searchParams: Promise.resolve({ created: "true" }) });
    render(ui);

    expect(screen.getByText("Promotion submitted")).toBeInTheDocument();
    expect(screen.getByText(/waiting for moderation/i)).toBeInTheDocument();
  });

  it("surfaces a resubmission banner after editing a promotion", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "promotions" || table === "listings" || table === "businesses") {
        return createThenableQuery([]);
      }

      return createThenableQuery([]);
    });

    const ui = await PromotionsPage({ searchParams: Promise.resolve({ updated: "true" }) });
    render(ui);

    expect(screen.getByText("Promotion updated")).toBeInTheDocument();
    expect(screen.getByText(/resubmitted for review/i)).toBeInTheDocument();
  });
});
