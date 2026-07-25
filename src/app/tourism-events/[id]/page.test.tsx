import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TourismEventDetailPage from "./page";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";

const { mockCreateClient, mockNotFound, mockTryCreateAdminClient, mockGetViewCounts } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockNotFound: vi.fn(() => {
      throw new Error("notFound");
    }),
    mockTryCreateAdminClient: vi.fn(),
    mockGetViewCounts: vi.fn().mockResolvedValue({
      ok: true,
      data: new Map([["promotion-1", 42]]),
    }),
  })
);

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ tryCreateAdminClient: mockTryCreateAdminClient }));
vi.mock("next/navigation", () => ({ notFound: mockNotFound }));
vi.mock("@/lib/engagement-server", () => ({ getOptionalContentViewCountMap: mockGetViewCounts }));
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
      <div>{promotion.view_count ?? 0}</div>
      <div>{advertiserProfile?.display_name ?? "No advertiser"}</div>
      <div>{linkedBusiness?.business_name ?? "No linked business"}</div>
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

      if (table === ACCOUNT_PROFILE_TABLE) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: options?.advertiserProfile ?? null }),
            }),
          }),
        };
      }

      if (table === "businesses") {
        // Supports both query shapes used on this table:
        //   loadBusinessDetail:      select → eq → maybeSingle
        //   linkedBusiness lookup:   select → eq → eq → maybeSingle (via applyVisibleExpiryFilter)
        const result = { data: options?.linkedBusiness ?? null };
        const chain: {
          eq: () => typeof chain;
          or: () => typeof chain;
          maybeSingle: () => Promise<typeof result>;
        } = {
          eq: () => chain,
          or: () => chain,
          maybeSingle: async () => result,
        };
        return {
          select: () => chain,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe("TourismEventDetailPage", () => {
  it("renders the canonical tourism detail content without its own header or footer shell", async () => {
    mockCreateClient.mockResolvedValue(
      buildClient({
        promotion: {
          id: "promotion-1",
          owner_id: "owner-1",
          business_id: "business-1",
          title: "Night Market",
          description: "Community event with food, music, and stalls.",
          status: "live",
          promotion_type: "event",
          price_cents: 5000,
          location_city: "Johannesburg",
          location_province: "Gauteng",
          photos: [],
        },
        advertiserProfile: {
          display_name: "Nomsa Advertiser",
          account_verification_status: "verified",
        },
        linkedBusiness: {
          id: "business-1",
          business_name: "Nomsa Kitchen",
          logo_url: null,
        },
      })
    );

    render(await TourismEventDetailPage({ params: Promise.resolve({ id: "promotion-1" }) }));

    expect(screen.getByText("Tourism Detail Mock")).toBeInTheDocument();
    expect(screen.getAllByText("Night Market")).toHaveLength(2);
    expect(screen.getByText("Nomsa Advertiser")).toBeInTheDocument();
    expect(screen.getByText("Nomsa Kitchen")).toBeInTheDocument();
    expect(screen.queryByText("Header")).not.toBeInTheDocument();
    expect(screen.queryByText("Footer")).not.toBeInTheDocument();
  });

  it("calls notFound when the canonical tourism promotion is missing", async () => {
    mockCreateClient.mockResolvedValue(buildClient({ promotion: null }));

    await expect(
      TourismEventDetailPage({ params: Promise.resolve({ id: "missing-promotion" }) })
    ).rejects.toThrow("notFound");
  });
});
