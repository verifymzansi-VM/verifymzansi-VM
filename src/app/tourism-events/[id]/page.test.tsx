import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TourismEventDetailPage from "./page";

const { mockNotFound, readings } = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  readings: {
    businessDetail: vi.fn(),
    eventDetail: vi.fn(),
    eventHostBusiness: vi.fn(),
    publicDetail: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/foundation/marketplace-server", () => ({
  restoredBusinessDetail: readings.businessDetail,
  restoredEventDetail: readings.eventDetail,
  restoredEventHostBusiness: readings.eventHostBusiness,
  restoredPublicDetail: readings.publicDetail,
}));
vi.mock("next/navigation", () => ({ notFound: mockNotFound, redirect: vi.fn() }));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/components/listings/promotion-detail-content", () => ({
  PromotionDetailContent: ({
    promotion,
    advertiserProfile,
    linkedBusiness,
  }: {
    promotion: { title: string; view_count?: number | null };
    advertiserProfile: { display_name?: string | null } | null;
    linkedBusiness: { business_name?: string | null } | null;
  }) => (
    <div>
      <div>Tourism Detail Mock</div>
      <div>{promotion.title}</div>
      <div>{advertiserProfile?.display_name ?? "No advertiser"}</div>
      <div>{linkedBusiness?.business_name ?? "No linked business"}</div>
    </div>
  ),
}));

describe("TourismEventDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Not a tourism business, so the page shows the event.
    readings.businessDetail.mockResolvedValue(null);
  });

  it("renders the canonical tourism detail content without its own header or footer shell", async () => {
    readings.eventDetail.mockResolvedValue({
      id: "promotion-1",
      owner_id: "",
      business_id: "business-1",
      title: "Night Market",
      description: "Community event with food, music, and stalls.",
      status: "live",
      promotion_type: "event",
      price_cents: 5000,
      location_city: "Johannesburg",
      location_province: "Gauteng",
      photos: [],
    });
    readings.publicDetail.mockResolvedValue({
      seller: { public_name: "Nomsa Advertiser", identity_verified: true },
    });
    readings.eventHostBusiness.mockResolvedValue({
      id: "business-1",
      business_name: "Nomsa Kitchen",
      logo_url: null,
    });

    render(await TourismEventDetailPage({ params: Promise.resolve({ id: "promotion-1" }) }));

    expect(screen.getByText("Tourism Detail Mock")).toBeInTheDocument();
    expect(screen.getAllByText("Night Market")).toHaveLength(2);
    // Public names show the first name and surname initial.
    expect(screen.getByText("Nomsa A.")).toBeInTheDocument();
    expect(screen.getByText("Nomsa Kitchen")).toBeInTheDocument();
    expect(readings.eventHostBusiness).toHaveBeenCalledWith("business-1");
    expect(screen.queryByText("Header")).not.toBeInTheDocument();
    expect(screen.queryByText("Footer")).not.toBeInTheDocument();
  });

  it("calls notFound when the canonical tourism promotion is missing", async () => {
    readings.eventDetail.mockResolvedValue(null);

    await expect(
      TourismEventDetailPage({ params: Promise.resolve({ id: "missing-promotion" }) })
    ).rejects.toThrow("notFound");
  });
});
