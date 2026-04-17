import { fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/contexts/video-playback-context", () => ({
  useVideoPlaybackManager: () => ({
    register: vi.fn(),
    unregister: vi.fn(),
    updateVisibility: vi.fn(),
    requestPriority: vi.fn(),
    releasePriority: vi.fn(),
    claimExclusive: vi.fn(),
    releaseExclusive: vi.fn(),
  }),
}));

function buildClient(
  business: Record<string, unknown>,
  options?: {
    promotions?: Array<Record<string, unknown>>;
    user?: { id: string } | null;
    onBusinessSelect?: (fields: string) => void;
    businessSelectResponses?: Array<{
      data: Record<string, unknown> | null;
      error?: { code?: string; message?: string } | null;
    }>;
  }
) {
  let businessSelectCallIndex = 0;
  return {
    auth: {
      getUser: async () => ({ data: { user: options?.user ?? null } }),
    },
    from: (table: string) => {
      if (table === "businesses") {
        return {
          select: (fields: string) => {
            options?.onBusinessSelect?.(fields);
            const selectResponse = options?.businessSelectResponses?.[
              Math.min(
                businessSelectCallIndex++,
                Math.max((options?.businessSelectResponses?.length ?? 1) - 1, 0)
              )
            ] ?? { data: business, error: null };
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: selectResponse.data,
                  error: selectResponse.error ?? null,
                }),
                single: async () => ({
                  data: selectResponse.data ?? business,
                  error: selectResponse.error ?? null,
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
  it("shows live business details publicly", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: /Business Details/i }));
    expect(screen.getByText("Service suburb")).toBeInTheDocument();
    expect(screen.getByText("Noordwyk")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Share/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Report/i })).toBeInTheDocument();
    expect(screen.queryByText("Open Map Directions")).not.toBeInTheDocument();
  });

  it("loads detail records without hard-coding the removed seller_id column", async () => {
    const businessSelectSpy = vi.fn((fields: string) => {
      expect(fields).not.toContain("seller_id");
      expect(fields).toContain("owner_id");
    });

    mockCreateClient.mockResolvedValue(
      buildClient(
        {
          id: "business-compat-1",
          owner_id: "owner-1",
          business_name: "Compat Business",
          description: "Detail page should work on the owner_id schema.",
          status: "live",
          business_type: "standalone_shop",
          category: "professional_services",
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
            type: "standalone_shop",
            street_address: "24 Vilakazi Street",
            suburb: "Orlando West",
          },
        },
        { onBusinessSelect: businessSelectSpy }
      )
    );

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-compat-1" }) }));

    expect(businessSelectSpy).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Compat Business").length).toBeGreaterThan(0);
  });

  it("falls back when the businesses table does not yet expose view_count", async () => {
    const businessSelectSpy = vi.fn();

    mockCreateClient.mockResolvedValue(
      buildClient(
        {
          id: "business-compat-view-count",
          owner_id: "owner-1",
          business_name: "Fallback Business",
          description: "Should still load without businesses.view_count.",
          status: "live",
          business_type: "standalone_shop",
          category: "professional_services",
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
          business_details: null,
          layout_template: "showcase",
        },
        {
          onBusinessSelect: businessSelectSpy,
          businessSelectResponses: [
            {
              data: null,
              error: {
                code: "42703",
                message: "column businesses.view_count does not exist",
              },
            },
            {
              data: {
                id: "business-compat-view-count",
                owner_id: "owner-1",
                business_name: "Fallback Business",
                description: "Should still load without businesses.view_count.",
                status: "live",
                business_type: "standalone_shop",
                category: "professional_services",
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
                business_details: null,
              },
              error: null,
            },
          ],
        }
      )
    );

    render(
      await BusinessDetailPage({ params: Promise.resolve({ id: "business-compat-view-count" }) })
    );

    expect(businessSelectSpy).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("Fallback Business").length).toBeGreaterThan(0);
  });

  it("renders owner preview for a pending business and hides public actions", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient(
        {
          id: "business-2",
          owner_id: "owner-1",
          business_name: "Mzansi Online",
          description: "Shop online.",
          status: "pending_moderation",
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
          delivery_options: ["delivery"],
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
            support_response_time: "Within 2 hours",
          },
        },
        { user: { id: "owner-1" } }
      )
    );

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-2" }) }));

    expect(screen.getByRole("alert")).toHaveTextContent("Owner preview");
    expect(screen.getByRole("alert")).toHaveTextContent(/pending moderation/i);
    expect(screen.queryByRole("button", { name: /Share/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Report/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Business Details/i }));
    expect(screen.getByText("Primary order channel")).toBeInTheDocument();
  });

  it("returns notFound for a pending business when the viewer is not the owner", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient(
        {
          id: "business-3",
          owner_id: "owner-1",
          business_name: "Nomsa Socials",
          description: "Find us online.",
          status: "draft",
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
        },
        { user: { id: "someone-else" } }
      )
    );

    await expect(
      BusinessDetailPage({ params: Promise.resolve({ id: "business-3" }) })
    ).rejects.toThrow("notFound");
  });

  it("renders online ordering details", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        id: "business-4",
        owner_id: "owner-1",
        business_name: "Legacy Online",
        description: "Legacy online listing.",
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
          order_url: "https://legacy-orders.example.com",
          delivery_regions: ["Nationwide", "Gauteng"],
        },
      })
    );

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-4" }) }));

    fireEvent.click(screen.getByRole("button", { name: /Payment & Delivery/i }));
    expect(screen.getByText("Delivery")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Business Details/i }));
    expect(screen.getByRole("link", { name: /Order Online/i })).toHaveAttribute(
      "href",
      "https://legacy-orders.example.com"
    );
    expect(screen.queryByText("Nationwide")).not.toBeInTheDocument();
  });

  it("does not render legacy online icon links in the unified layout", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        id: "business-5",
        owner_id: "owner-1",
        business_name: "Nomsa Market Kitchen",
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

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-5" }) }));

    expect(screen.queryByTitle("Website")).not.toBeInTheDocument();
    expect(screen.queryByTitle("TikTok")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Share/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Report/i })).toBeInTheDocument();
  });

  it("renders the linked mall name for mall stores", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        id: "business-6",
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

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-6" }) }));

    fireEvent.click(screen.getByRole("button", { name: /Business Details/i }));
    expect(screen.getByText("Mall")).toBeInTheDocument();
    expect(screen.getByText("Maponya Mall")).toBeInTheDocument();
  });

  it("renders linked promotions through the shared business detail content", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient(
        {
          id: "business-7",
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

    render(await BusinessDetailPage({ params: Promise.resolve({ id: "business-7" }) }));

    expect(screen.getByText("Promotions & Offers")).toBeInTheDocument();
    expect(screen.getByText("Promotion")).toBeInTheDocument();
    expect(promotionCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "https://example.com/business-logo.jpg",
      })
    );
  });
});
