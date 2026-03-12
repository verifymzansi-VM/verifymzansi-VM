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

    // Setup mock query resolution for listings
    const queryBuilderListings = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
      then: vi.fn((resolve) =>
        resolve({
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
        })
      ),
    };

    mockSupabase.from.mockImplementation((table) => {
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

    const queryBuilderListings = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
      then: vi.fn((resolve) => resolve({ data: [] })),
    };

    mockSupabase.from.mockImplementation((table) => {
      if (table === "listings") return queryBuilderListings;
    });

    const ui = await ListingsPage();
    render(ui);

    expect(queryBuilderListings.eq).toHaveBeenCalledWith("owner_id", "u-123");
    expect(screen.getByText(/Active \(0\)/)).toBeDefined();
  });
});
