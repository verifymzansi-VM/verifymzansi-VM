import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PromotionDetailPage from "./page";

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
vi.mock("@/components/listings/promotion-detail-content", () => ({
  PromotionDetailContent: ({
    promotion,
    advertiserProfile,
    linkedBusiness,
  }: {
    promotion: { title: string; start_date?: string | null; end_date?: string | null };
    advertiserProfile: { display_name?: string | null } | null;
    linkedBusiness: { business_name?: string | null } | null;
  }) => (
    <div>
      <div>Promotion Detail Mock</div>
      <div>{promotion.title}</div>
      <div>{advertiserProfile?.display_name ?? "No advertiser"}</div>
      <div>{linkedBusiness?.business_name ?? "No linked business"}</div>
      {promotion.start_date ? <div>Starts {promotion.start_date}</div> : null}
      {promotion.end_date ? <div>Ends {promotion.end_date}</div> : null}
    </div>
  ),
}));

function buildClient(options?: {
  promotion?: Record<string, unknown> | null;
  advertiserProfile?: Record<string, unknown> | null;
  linkedBusiness?: Record<string, unknown> | null;
}) {
  return {
    from: (table: string) => {
      if (table === "promotions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: options?.promotion ?? null }),
              }),
            }),
          }),
        };
      }

      if (table === "seller_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: options?.advertiserProfile ?? null }),
            }),
          }),
        };
      }

      if (table === "businesses") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: options?.linkedBusiness ?? null }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe("PromotionDetailPage", () => {
  it("renders the promotion detail content with advertiser and linked business context", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        promotion: {
          id: "promotion-1",
          seller_id: "seller-1",
          business_id: "business-1",
          title: "Night Market",
          description: "Community event with food, music, and stalls.",
          status: "live",
          promotion_type: "event",
          price_cents: 5000,
          start_date: "2099-03-10",
          end_date: "2099-03-12",
          photos: [],
        },
        advertiserProfile: {
          display_name: "Nomsa Advertiser",
          seller_verification_status: "verified",
        },
        linkedBusiness: {
          id: "business-1",
          business_name: "Nomsa Kitchen",
          logo_url: null,
        },
      })
    );

    render(await PromotionDetailPage({ params: Promise.resolve({ id: "promotion-1" }) }));

    expect(screen.getByText("Promotion Detail Mock")).toBeInTheDocument();
    expect(screen.getAllByText("Night Market")).toHaveLength(2);
    expect(screen.getByText("Nomsa Advertiser")).toBeInTheDocument();
    expect(screen.getByText("Nomsa Kitchen")).toBeInTheDocument();
    expect(screen.getByText("Starts 2099-03-10")).toBeInTheDocument();
    expect(screen.getByText("Ends 2099-03-12")).toBeInTheDocument();
  });

  it("calls notFound when the promotion is missing", async () => {
    mockCreateClient.mockResolvedValue(buildClient({ promotion: null }));

    await expect(
      PromotionDetailPage({ params: Promise.resolve({ id: "missing-promotion" }) })
    ).rejects.toThrow("notFound");
  });
});
