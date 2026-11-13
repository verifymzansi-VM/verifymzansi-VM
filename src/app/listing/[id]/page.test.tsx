import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ListingDetailPage from "./page";

const { mockGetUser, mockNotFound, listingDetail, publicDetail, readCollection } = vi.hoisted(
  () => ({
    mockGetUser: vi.fn(),
    mockNotFound: vi.fn(() => {
      throw new Error("notFound");
    }),
    listingDetail: vi.fn(),
    publicDetail: vi.fn(),
    readCollection: vi.fn(),
  })
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mockGetUser } }),
}));
vi.mock("@/lib/foundation/marketplace-server", () => ({
  restoredListingDetail: listingDetail,
  restoredPublicDetail: publicDetail,
}));
vi.mock("@/lib/foundation/marketplace-read", () => ({ readRestoredCollection: readCollection }));
vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: () => "api" }));
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

describe("ListingDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("renders the listing detail content with seller and similar listing context", async () => {
    listingDetail.mockResolvedValue({
      id: "listing-1",
      owner_id: "",
      title: "Used iPhone 15",
      description: "Clean phone in excellent condition.",
      status: "live",
      price_cents: 150000,
      price_negotiable: true,
      category: "electronics",
      attributes: { brand: "Apple" },
      photos: [],
      contact_methods: ["call"],
      location_province: "Gauteng",
      location_city: "Johannesburg",
    });
    publicDetail.mockResolvedValue({
      seller: { public_name: "Nomsa Seller", identity_verified: true },
    });
    readCollection.mockResolvedValue({
      rows: [
        { id: "listing-1", title: "Used iPhone 15" },
        {
          id: "listing-2",
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
      total: 2,
    });

    render(await ListingDetailPage({ params: Promise.resolve({ id: "listing-1" }) }));

    expect(screen.getByText("Listing Detail Mock")).toBeInTheDocument();
    expect(screen.getAllByText("Used iPhone 15")).toHaveLength(2);
    // Public names show the first name and surname initial.
    expect(screen.getByText("Nomsa S.")).toBeInTheDocument();
    expect(screen.getByText("Brand Apple")).toBeInTheDocument();
    // The current post is never offered as similar to itself.
    expect(screen.getByText("Similar count: 1")).toBeInTheDocument();
    expect(screen.getByText("Similar seller count: 0")).toBeInTheDocument();
    expect(screen.getByText("Samsung Galaxy S24")).toBeInTheDocument();
    expect(readCollection).toHaveBeenCalledWith("api", "listings", expect.any(URLSearchParams));
    expect(String(readCollection.mock.calls[0][2])).toBe("category=electronics&limit=5");
  });

  it("calls notFound when the listing is missing", async () => {
    listingDetail.mockResolvedValue(null);

    await expect(
      ListingDetailPage({ params: Promise.resolve({ id: "missing-listing" }) })
    ).rejects.toThrow("notFound");
    expect(readCollection).not.toHaveBeenCalled();
  });
});
