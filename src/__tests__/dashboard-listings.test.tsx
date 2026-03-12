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

    // Setup mock query resolution for profile
    const queryBuilderProfile = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "p-456" } }),
    };

    // Setup mock query resolution for listings
    const queryBuilderListings = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: "1",
            title: "Car",
            status: "active",
            price_zar: 100,
            created_at: "2023-01-01T00:00:00.000Z",
          },
          {
            id: "2",
            title: "Bike",
            status: "pending_review",
            price_zar: 50,
            created_at: "2023-01-01T00:00:00.000Z",
          },
        ],
      }),
    };

    // Switch implementations based on requested tables
    mockSupabase.from.mockImplementation((table) => {
      if (table === "account_profiles") return queryBuilderProfile;
      if (table === "listings") return queryBuilderListings;
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

    // Simulate user who doesn't have an account profile (returns null)
    const queryBuilderProfile = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
    };

    const queryBuilderListings = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [] }),
    };

    mockSupabase.from.mockImplementation((table) => {
      if (table === "account_profiles") return queryBuilderProfile;
      if (table === "listings") return queryBuilderListings; // This shouldn't be called!
    });

    const ui = await ListingsPage();
    render(ui);

    // Profile is missing, so it shouldn't try querying listings with empty UUIDs
    expect(queryBuilderListings.eq).not.toHaveBeenCalledWith("owner_id", "");
    expect(screen.getByText(/Active \(0\)/)).toBeDefined();
  });
});
