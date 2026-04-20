import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ListingsPage from "./page";
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

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <div aria-label={alt} data-src={src} role="img" />
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children }: React.PropsWithChildren<{ value: string }>) => (
    <button type="button">{children}</button>
  ),
  TabsContent: ({ children }: React.PropsWithChildren<{ value: string }>) => <div>{children}</div>,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({
    title,
    description,
    children,
  }: React.PropsWithChildren<{ title: string; description?: string }>) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </div>
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
  canUrgent: vi.fn().mockReturnValue({ allowed: true }),
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

vi.mock("@/components/listings/resubmit-button", () => ({
  ResubmitButton: () => <button type="button">Resubmit</button>,
}));

vi.mock("@/components/listings/delete-post-button", () => ({
  DeletePostButton: () => <button type="button">Delete</button>,
}));

vi.mock("@/components/dashboard/area-filter", () => ({
  AreaFilter: () => <div data-testid="area-filter" />,
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: React.PropsWithChildren) => <div role="alert">{children}</div>,
  AlertTitle: ({ children }: React.PropsWithChildren) => <strong>{children}</strong>,
  AlertDescription: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

function createOrderedQuery(data: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data, error: null, count: null }),
    }),
  };
}

describe("Dashboard listings page", () => {
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

  it("aggregates mixed-area content and exposes rejected recovery actions", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "listings") {
        return createOrderedQuery([
          {
            id: "listing-active",
            title: "City Hatchback",
            status: "active",
            price_cents: 12990000,
            category: "Cars",
            created_at: "2026-03-05T00:00:00.000Z",
            area: "MZANSI_MARKET",
            photos: ["https://example.com/car.jpg"],
            boost_until: null,
            featured_until: null,
            urgent_until: null,
            status_reason: null,
          },
          {
            id: "listing-rejected",
            title: "Needs VIN photo",
            status: "rejected",
            price_cents: 9800000,
            category: "Cars",
            created_at: "2026-03-04T00:00:00.000Z",
            area: "MZANSI_MARKET",
            photos: [],
            boost_until: null,
            featured_until: null,
            urgent_until: null,
            status_reason: "Add a clear VIN photo before resubmitting.",
          },
          {
            id: "listing-expired",
            title: "Old trailer",
            status: "expired",
            price_cents: 2500000,
            category: "Trailers",
            created_at: "2026-02-15T00:00:00.000Z",
            area: "MZANSI_MARKET",
            photos: [],
            boost_until: null,
            featured_until: null,
            urgent_until: null,
            status_reason: null,
          },
        ]);
      }

      if (table === "businesses") {
        return createOrderedQuery([
          {
            id: "business-pending",
            business_name: "Senzo Repairs",
            status: "pending_review",
            category: "Services",
            created_at: "2026-03-06T00:00:00.000Z",
            cover_photo: null,
            logo_url: null,
            gallery_photos: [],
            boost_until: null,
            featured_until: null,
            status_reason: null,
          },
          {
            id: "business-rejected",
            business_name: "Township Tutors",
            status: "rejected",
            category: "Education",
            created_at: "2026-03-03T00:00:00.000Z",
            cover_photo: null,
            logo_url: null,
            gallery_photos: [],
            boost_until: null,
            featured_until: null,
            status_reason: null,
          },
        ]);
      }

      if (table === "promotions") {
        return createOrderedQuery([
          {
            id: "promo-rejected",
            title: "Youth Market Day",
            status: "rejected",
            price_cents: null,
            category: "Events",
            created_at: "2026-03-02T00:00:00.000Z",
            photos: [],
            view_count: 14,
            boost_until: null,
            featured_until: null,
            status_reason: "Clarify the event venue before review.",
            promotion_type: "EVENT",
          },
        ]);
      }

      return createOrderedQuery([]);
    });

    render(await ListingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "My Posts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Under Review (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejected (3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ended (1)" })).toBeInTheDocument();

    expect(screen.getByText("Needs VIN photo")).toBeInTheDocument();
    expect(screen.getByText("Township Tutors")).toBeInTheDocument();
    expect(screen.getByText("Youth Market Day")).toBeInTheDocument();
    expect(screen.getByText(/Add a clear VIN photo before resubmitting\./i)).toBeInTheDocument();
    expect(screen.getByText(/Clarify the event venue before review\./i)).toBeInTheDocument();
    expect(
      screen.getByText("This item was rejected. No specific reason was provided.")
    ).toBeInTheDocument();

    expect(document.querySelector('a[href="/post/edit-listing/listing-rejected"]')).toBeTruthy();
    expect(document.querySelector('a[href="/post/edit-business/business-rejected"]')).toBeTruthy();
    expect(document.querySelector('a[href="/post/edit-tourism/promo-rejected"]')).toBeTruthy();

    expect(screen.getAllByRole("button", { name: "Resubmit" })).toHaveLength(3);
    expect(screen.getAllByText(/Edit your content then resubmit for review/i)).toHaveLength(3);
  });
});
