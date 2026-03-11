import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ListingDetailPage from "./page";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";

const { mockCreateClient, mockNotFound } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("next/navigation", () => ({ notFound: mockNotFound }));
vi.mock("@/components/layout/header", () => ({
  Header: () => <header>Header</header>,
}));
vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer>Footer</footer>,
}));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/components/listings/listing-detail-content", () => ({
  ListingDetailContent: ({
    listing,
    seller,
    similarItems,
    similarSellers,
  }: {
    listing: { title: string; attributes?: Record<string, unknown> | null };
    seller: { display_name?: string | null } | null;
    similarItems: Array<{ title: string }>;
    similarSellers: Map<string, { display_name: string }>;
  }) => (
    <div>
      <div>Listing Detail Mock</div>
      <div>{listing.title}</div>
      <div>{seller?.display_name ?? "No seller"}</div>
      <div>Similar count: {similarItems.length}</div>
      <div>Similar seller count: {similarSellers.size}</div>
      {listing.attributes?.brand ? <div>Brand {String(listing.attributes.brand)}</div> : null}
      {similarItems[0] ? <div>{similarItems[0].title}</div> : null}
    </div>
  ),
}));

function buildClient(options?: {
  listing?: Record<string, unknown> | null;
  seller?: Record<string, unknown> | null;
  similarListings?: Array<Record<string, unknown>>;
  similarSellers?: Array<Record<string, unknown>>;
}) {
  return {
    from: (table: string) => {
      if (table === "listings") {
        return {
          select: (query: string) => {
            if (query === "*") {
              return {
                eq: () => ({
                  eq: () => ({
                    single: async () => ({ data: options?.listing ?? null }),
                  }),
                }),
              };
            }

            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    neq: () => ({
                      order: () => ({
                        limit: async () => ({ data: options?.similarListings ?? [] }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          },
        };
      }

      if (table === ACCOUNT_PROFILE_TABLE) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: options?.seller ?? null }),
            }),
            in: async () => ({ data: options?.similarSellers ?? [] }),
          }),
        };
      }

      if (table === "listing_views") {
        return {
          insert: () => Promise.resolve({ data: null, error: null }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe("ListingDetailPage", () => {
  it("renders the listing detail content with seller and similar listing context", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        listing: {
          id: "listing-1",
          seller_id: "seller-1",
          title: "Used iPhone 15",
          description: "Clean phone in excellent condition.",
          status: "live",
          price_cents: 150000,
          price_negotiable: true,
          category: "electronics",
          attributes: { brand: "Apple" },
          photos: [],
          location_province: "Gauteng",
          location_city: "Johannesburg",
        },
        seller: {
          display_name: "Nomsa Seller",
          seller_verification_status: "verified",
          phone: "0821234567",
          masked_phone_public: "082***4567",
        },
        similarListings: [
          {
            id: "listing-2",
            seller_id: "seller-2",
            title: "Samsung Galaxy S24",
            price_cents: 120000,
            price_negotiable: false,
            condition: "used",
            photos: [],
            location_province: "Gauteng",
            location_city: "Johannesburg",
            category: "electronics",
            attributes: { brand: "Samsung" },
            created_at: "2026-03-08T00:00:00.000Z",
            boost_until: null,
            featured: false,
          },
        ],
        similarSellers: [
          {
            user_id: "seller-2",
            display_name: "Tech Store",
            seller_verification_status: "verified",
          },
        ],
      })
    );

    render(await ListingDetailPage({ params: Promise.resolve({ id: "listing-1" }) }));

    expect(screen.getByText("Listing Detail Mock")).toBeInTheDocument();
    expect(screen.getAllByText("Used iPhone 15")).toHaveLength(2);
    expect(screen.getByText("Nomsa Seller")).toBeInTheDocument();
    expect(screen.getByText("Brand Apple")).toBeInTheDocument();
    expect(screen.getByText("Similar count: 1")).toBeInTheDocument();
    expect(screen.getByText("Similar seller count: 1")).toBeInTheDocument();
    expect(screen.getByText("Samsung Galaxy S24")).toBeInTheDocument();
  });

  it("calls notFound when the listing is missing", async () => {
    mockCreateClient.mockResolvedValue(buildClient({ listing: null }));

    await expect(
      ListingDetailPage({ params: Promise.resolve({ id: "missing-listing" }) })
    ).rejects.toThrow("notFound");
  });
});
