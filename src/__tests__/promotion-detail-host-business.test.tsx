import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromotionDetailPageContent } from "@/app/(marketplace)/_lib/promotion-detail-page-content";
import { createClient } from "@/lib/supabase/server";
import {
  restoredEventDetail,
  restoredEventHostBusiness,
  restoredPublicDetail,
} from "@/lib/foundation/marketplace-server";

// Event page on the foundation backend (the vitest default): the host
// business card's data comes from the live database's public reads, never from
// the old backend's businesses table.

const { legacyFrom, captured } = vi.hoisted(() => ({
  legacyFrom: vi.fn(() => {
    throw new Error("old backend table read in foundation mode");
  }),
  captured: { linkedBusiness: undefined as unknown },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: legacyFrom,
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: vi.fn(() => {
    throw new Error("old admin client in foundation mode");
  }),
}));
vi.mock("@/lib/foundation/marketplace-server", () => ({
  restoredEventDetail: vi.fn(),
  restoredPublicDetail: vi.fn(),
  restoredEventHostBusiness: vi.fn(),
}));
vi.mock("@/lib/engagement-server", () => ({
  getOptionalContentViewCountMap: vi.fn().mockResolvedValue({ ok: false }),
  getOptionalContentLikeSummaryMap: vi.fn().mockResolvedValue({ ok: false }),
  getOptionalContentShareCountMap: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/utils/request-context", () => ({
  getOptionalCookieStore: vi.fn().mockResolvedValue(null),
  readCookieValue: vi.fn(() => null),
}));
vi.mock("@/components/immersive/immersive-detail-gate", () => ({
  ImmersiveDetailGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/analytics/contact-action-tracker", () => ({
  ContactActionTracker: () => null,
}));
vi.mock("@/components/layout/breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/listings/promotion-detail-content", () => ({
  PromotionDetailContent: ({
    promotion,
    linkedBusiness,
  }: {
    promotion: { title: string };
    linkedBusiness: { business_name: string } | null;
  }) => {
    captured.linkedBusiness = linkedBusiness;
    return (
      <div>
        <p>{promotion.title}</p>
        <p>{linkedBusiness ? `Host: ${linkedBusiness.business_name}` : "No host card"}</p>
      </div>
    );
  },
}));

const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const businessId = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const event = (business_id: string | null) =>
  ({
    id: eventId,
    owner_id: "",
    business_id,
    title: "Fixture Night Market",
    description: null,
    photos: [],
    videos: [],
    contact_methods: ["form"],
    location_city: null,
    location_province: null,
  }) as never;
const host = {
  id: businessId,
  owner_id: null,
  business_name: "Fixture Kitchen",
  logo_url: null,
  cipc_verified_at: "2026-10-02T10:00:00Z",
  cipc_expires_at: "2099-10-02T10:00:00Z",
  seen_verified_at: "2026-10-01T10:00:00Z",
  seen_expires_at: "2020-10-01T10:00:00Z",
  seen_method: "visit",
  seen_city: "Soweto",
  owner_verified_role: "director",
  owner_position_title: "Director",
};

beforeEach(() => {
  vi.clearAllMocks();
  captured.linkedBusiness = undefined;
  vi.mocked(restoredPublicDetail).mockResolvedValue({
    seller: { public_name: "Tester T.", identity_verified: true },
  } as never);
});

describe("event page host business (foundation backend)", () => {
  it("shows the live host business from the public reads, rechecking sticker expiry", async () => {
    vi.mocked(restoredEventDetail).mockResolvedValue(event(businessId));
    vi.mocked(restoredEventHostBusiness).mockResolvedValue(host);
    render(await PromotionDetailPageContent({ id: eventId }));
    expect(screen.getByText("Host: Fixture Kitchen")).toBeInTheDocument();
    expect(restoredEventHostBusiness).toHaveBeenCalledExactlyOnceWith(businessId);
    // The page's own toPublicVerification still runs: the expired Seen sticker is cleared.
    expect(captured.linkedBusiness).toMatchObject({
      id: businessId,
      cipc_verified_at: "2026-10-02T10:00:00Z",
      seen_verified_at: null,
      seen_method: null,
    });
    expect(legacyFrom).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalled();
  });

  it("renders the event without a host card when the business is not live or a read failed", async () => {
    vi.mocked(restoredEventDetail).mockResolvedValue(event(businessId));
    vi.mocked(restoredEventHostBusiness).mockResolvedValue(null);
    render(await PromotionDetailPageContent({ id: eventId }));
    expect(screen.getByText("Fixture Night Market")).toBeInTheDocument();
    expect(screen.getByText("No host card")).toBeInTheDocument();
    expect(legacyFrom).not.toHaveBeenCalled();
  });

  it("asks for no host business when the event names none", async () => {
    vi.mocked(restoredEventDetail).mockResolvedValue(event(null));
    render(await PromotionDetailPageContent({ id: eventId }));
    expect(screen.getByText("No host card")).toBeInTheDocument();
    expect(restoredEventHostBusiness).not.toHaveBeenCalled();
    expect(legacyFrom).not.toHaveBeenCalled();
  });
});
