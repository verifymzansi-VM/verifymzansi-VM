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
vi.mock("@/components/dashboard/area-filter", () => ({
  AreaFilter: () => <div data-testid="area-filter" />,
}));
vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: React.PropsWithChildren) => <div role="alert">{children}</div>,
  AlertTitle: ({ children }: React.PropsWithChildren) => <strong>{children}</strong>,
  AlertDescription: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
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
    const ui = await ListingsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    // Assertions
    expect(screen.getByRole("heading", { name: /Your Content/i })).toBeDefined();
    expect(screen.getByText(/Active \(1\)/)).toBeDefined();
    expect(screen.getByText(/Under Review \(1\)/)).toBeDefined();
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

    const ui = await ListingsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText(/Active \(0\)/)).toBeDefined();
  });

  it("renders rejected listings when optional listing columns are missing", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u-123" } } });

    mockSupabase.from.mockImplementation((table) => {
      const createQuery = (
        resolver: (selectClause: string) => { data: unknown[]; error?: unknown }
      ) => ({
        select: vi.fn().mockImplementation((selectClause: string) => ({
          order: vi.fn().mockResolvedValue(resolver(selectClause)),
        })),
      });

      if (table === "listings") {
        return createQuery((selectClause) => {
          if (selectClause.includes("urgent_until")) {
            return {
              data: [],
              error: {
                code: "42703",
                message: "column listings.urgent_until does not exist",
              },
            };
          }

          return {
            data: [
              {
                id: "reject-1",
                title: "Rejected Car",
                status: "rejected",
                price_cents: 10000,
                created_at: "2023-01-01T00:00:00.000Z",
                area: "MZANSI_MARKET",
                photos: [],
                status_reason: "Missing proof of ownership",
              },
            ],
            error: null,
          };
        });
      }

      if (table === "businesses" || table === "promotions") {
        return createQuery(() => ({ data: [], error: null }));
      }
    });

    const ui = await ListingsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByRole("tab", { name: /Rejected \(1\)/ })).toBeDefined();
  });
});
