import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BusinessDetailPage from "./page";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));
const { promotionCardSpy } = vi.hoisted(() => ({
  promotionCardSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt} />,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("@/components/layout/header", () => ({
  Header: () => <header>Header</header>,
}));
vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer>Footer</footer>,
}));
vi.mock("@/components/listings/business-gallery", () => ({
  BusinessGallery: () => <div>Gallery</div>,
}));
vi.mock("@/components/listings/business-promo-video", () => ({
  BusinessPromoVideo: () => <div>Video</div>,
}));
vi.mock("@/components/listings/promotion-card", () => ({
  PromotionCard: (props: unknown) => {
    promotionCardSpy(props);
    return <div>Promotion</div>;
  },
}));
vi.mock("@/components/shared/share-button", () => ({
  ShareButton: () => <button>Share</button>,
}));
vi.mock("@/components/shared/report-dialog", () => ({
  ReportDialog: () => <button>Report</button>,
}));
vi.mock("@/components/trust/trust-badge", () => ({
  TrustBadge: () => <span>Trust</span>,
}));

function buildClient(
  business: Record<string, unknown>,
  options?: {
    promotions?: Array<Record<string, unknown>>;
  }
) {
  return {
    from: (table: string) => {
      if (table === "businesses") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: business }),
              }),
            }),
          }),
        };
      }
      if (table === ACCOUNT_PROFILE_TABLE) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "owner-1",
                  display_name: "Nomsa",
                  account_verification_status: "verified",
                  location_province: "Gauteng",
                  location_city: "Johannesburg",
                },
              }),
            }),
          }),
        };
      }
      if (table === "promotions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: options?.promotions ?? [] }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe("BusinessDetailPage", () => {
  it("shows home business privacy-safe details only", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        id: "business-1",
        owner_id: "owner-1",
        business_name: "Nomsa Home Studio",
        description: "A home-based studio.",
        status: "live",
        business_type: "home_business",
        category: "health_beauty",
        cover_photo: null,
        logo_url: null,
        cover_video: null,
        video_thumbnail: null,
        gallery_photos: [],
        social_links: {},
        operating_hours: {},
        services_offered: [],
        payment_methods_accepted: [],
        delivery_options: [],
        service_areas: null,
        location_city: "Johannesburg",
        location_province: "Gauteng",
        phone: null,
        whatsapp: null,
        email: null,
        website: null,
        store_number: null,
        map_directions: "https://maps.example.com/private-address",
        business_details: {
          type: "home_business",
          service_suburb: "Noordwyk",
          appointment_required: true,
          customer_pickup_allowed: false,
          visitor_notes: "Visits by appointment only.",
        },
      })
    );

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-1" }) }));

    expect(screen.getByText("Service suburb")).toBeInTheDocument();
    expect(screen.getByText("Noordwyk")).toBeInTheDocument();
    expect(screen.queryByText("Open Map Directions")).not.toBeInTheDocument();
  });

  it("renders online ordering details", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        id: "business-2",
        owner_id: "owner-1",
        business_name: "Mzansi Online",
        description: "Shop online.",
        status: "live",
        business_type: "online_only",
        category: "electronics_tech",
        cover_photo: null,
        logo_url: null,
        cover_video: null,
        video_thumbnail: null,
        gallery_photos: [],
        social_links: {},
        operating_hours: {},
        services_offered: [],
        payment_methods_accepted: [],
        delivery_options: [],
        service_areas: null,
        location_city: "Johannesburg",
        location_province: "Gauteng",
        phone: null,
        whatsapp: null,
        email: null,
        website: null,
        store_number: null,
        map_directions: null,
        business_details: {
          type: "online_only",
          primary_order_channel: "website",
          order_url: "https://orders.example.com",
          delivery_regions: ["Nationwide", "Gauteng"],
          support_response_time: "Within 2 hours",
        },
      })
    );

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-2" }) }));

    expect(screen.getByText("Primary order channel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Order Online/i })).toHaveAttribute(
      "href",
      "https://orders.example.com"
    );
    expect(screen.getByText("Nationwide")).toBeInTheDocument();
    expect(screen.getByText("Within 2 hours")).toBeInTheDocument();
  });

  it("renders website-only and TikTok links in the online section", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        id: "business-3",
        owner_id: "owner-1",
        business_name: "Nomsa Socials",
        description: "Find us online.",
        status: "live",
        business_type: "standalone_shop",
        category: "fashion_accessories",
        cover_photo: null,
        logo_url: null,
        cover_video: null,
        video_thumbnail: null,
        gallery_photos: [],
        social_links: { tiktok: "https://www.tiktok.com/@nomsa" },
        operating_hours: {},
        services_offered: [],
        payment_methods_accepted: [],
        delivery_options: [],
        service_areas: null,
        location_city: "Johannesburg",
        location_province: "Gauteng",
        phone: null,
        whatsapp: null,
        email: null,
        website: "https://nomsa.example.com",
        store_number: null,
        map_directions: null,
        business_details: {
          type: "standalone_shop",
          street_address: "24 Vilakazi Street",
          suburb: "Orlando West",
        },
      })
    );

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-3" }) }));

    expect(screen.getByTitle("Website")).toHaveAttribute("href", "https://nomsa.example.com");
    expect(screen.getByTitle("TikTok")).toHaveAttribute("href", "https://www.tiktok.com/@nomsa");
  });

  it("renders the linked mall name for mall stores", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        id: "business-4",
        owner_id: "owner-1",
        business_name: "Mall Style",
        description: "A mall store.",
        status: "live",
        business_type: "mall_store",
        category: "fashion_accessories",
        cover_photo: null,
        logo_url: null,
        cover_video: null,
        video_thumbnail: null,
        gallery_photos: [],
        social_links: {},
        operating_hours: {},
        services_offered: [],
        payment_methods_accepted: [],
        delivery_options: [],
        service_areas: null,
        location_city: "Johannesburg",
        location_province: "Gauteng",
        phone: null,
        whatsapp: null,
        email: null,
        website: null,
        store_number: "12A",
        map_directions: null,
        business_details: {
          type: "mall_store",
          mall_name: "Maponya Mall",
          mall_address: "2127 Chris Hani Rd, Soweto",
          mall_summary: "Near the cinema entrance.",
          mall_photos: [],
          floor_or_wing: "Upper Level",
          nearest_entrance: "Entrance 3",
          parking_notes: "",
        },
      })
    );

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-4" }) }));

    expect(screen.getByText("Mall")).toBeInTheDocument();
    expect(screen.getByText("Maponya Mall")).toBeInTheDocument();
  });

  it("renders linked promotions through the shared business detail content", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient(
        {
          id: "business-5",
          owner_id: "owner-1",
          business_name: "Nomsa Market Kitchen",
          description: "Fresh food and weekly events.",
          status: "live",
          business_type: "standalone_shop",
          category: "food_dining",
          cover_photo: null,
          logo_url: "https://example.com/business-logo.jpg",
          cover_video: null,
          video_thumbnail: null,
          gallery_photos: [],
          social_links: {},
          operating_hours: {},
          services_offered: [],
          payment_methods_accepted: [],
          delivery_options: [],
          service_areas: null,
          location_city: "Johannesburg",
          location_province: "Gauteng",
          phone: null,
          whatsapp: null,
          email: null,
          website: null,
          store_number: null,
          map_directions: null,
          business_details: {
            type: "standalone_shop",
            street_address: "24 Vilakazi Street",
            suburb: "Orlando West",
          },
        },
        {
          promotions: [
            {
              id: "promo-1",
              title: "Friday Food Special",
              price_cents: 9900,
              price_negotiable: false,
              photos: [],
              videos: [],
              video_thumbnail: null,
              category_key: "food_dining",
              category: "Food & Dining",
              location_province: "Gauteng",
              location_city: "Johannesburg",
              promotion_type: "deal",
              created_at: "2026-03-08T00:00:00.000Z",
              view_count: 12,
              boost_until: null,
              featured_until: null,
              end_date: "2099-03-12T00:00:00.000Z",
            },
          ],
        }
      )
    );

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-5" }) }));

    expect(screen.getByText("Promotions & Offers")).toBeInTheDocument();
    expect(screen.getByText("Promotion")).toBeInTheDocument();
    expect(promotionCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "https://example.com/business-logo.jpg",
      })
    );
  });
});
