import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ListingsPage from "@/app/dashboard/listings/page";
import { createClient } from "@/lib/supabase/server";

// 1. Mock dependencies
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
}));
vi.mock("@/lib/account/compat", () => ({
  applyOwnerFilter: vi.fn((query) => query),
  getOwnerColumn: vi.fn().mockResolvedValue("owner_id"),
}));
vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: vi.fn().mockResolvedValue("starter"),
}));
vi.mock("@/components/listings/boost-button", () => ({
  BoostButton: () => <button type="button">Boost</button>,
}));
vi.mock("@/components/listings/featured-button", () => ({
  FeaturedButton: () => <button type="button">Featured</button>,
}));
vi.mock("@/components/listings/urgent-button", () => ({
  UrgentButton: () => <button type="button">Urgent</button>,
}));
vi.mock("@/components/listings/delete-post-button", () => ({
  DeletePostButton: () => <button type="button">Delete</button>,
}));
vi.mock("@/components/listings/resubmit-button", () => ({
  ResubmitButton: () => <button type="button">Resubmit</button>,
}));

describe("ListingsPage", () => {
  const mockSupabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>
    );
  });

  it("[Happy Path] should render active and pending listings when profile exists", async () => {
    // Setup valid user
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u-123" } } });

    mockSupabase.from.mockImplementation((table) => {
      const createQuery = (data: unknown[]) => ({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockImplementation(() => ({
          then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data }),
        })),
      });

      if (table === "listings") {
        return createQuery([
          {
            id: "1",
            title: "Car",
            status: "active",
            price_cents: 10000,
            created_at: "2023-01-01T00:00:00.000Z",
            area: "MZANSI_MARKET",
            photos: [],
          },
          {
            id: "2",
            title: "Bike",
            status: "pending_review",
            price_cents: 5000,
            created_at: "2023-01-01T00:00:00.000Z",
            area: "MZANSI_MARKET",
            photos: [],
          },
        ]);
      }

      if (table === "businesses" || table === "promotions") {
        return createQuery([]);
      }
    });

    // Render RSC
    const ui = await ListingsPage();
    render(ui);

    // Assertions
    expect(screen.getByText(/Active \(1\)/)).toBeDefined();
    expect(screen.getByText(/Pending \(1\)/)).toBeDefined();
  });

  it("[Edge Case] should not attempt to fetch listings with missing profile UUID", async () => {
    // Setup valid user
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u-123" } } });

    mockSupabase.from.mockImplementation((table) => {
      const createQuery = () => ({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockImplementation(() => ({
          then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data: [] }),
        })),
      });

      if (table === "listings" || table === "businesses" || table === "promotions") {
        return createQuery();
      }
    });

    const ui = await ListingsPage();
    render(ui);

    expect(screen.getByText(/Active \(0\)/)).toBeDefined();
  });
});
