import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BusinessDetailPage from "./page";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
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
  PromotionCard: () => <div>Promotion</div>,
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

function buildClient(business: Record<string, unknown>) {
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
      if (table === "seller_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "seller-1",
                  display_name: "Nomsa",
                  location_province: "Gauteng",
                  location_city: "Johannesburg",
                  seller_verification_status: "verified",
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
                  limit: async () => ({ data: [] }),
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
        seller_id: "seller-1",
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
        seller_id: "seller-1",
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
});
