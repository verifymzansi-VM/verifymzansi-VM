import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  expectFoundationPostFields,
  expectTermsAcceptedBeforeSave,
  installFoundationPostFetch,
  POSTING_TERMS_TICK,
} from "@/test/foundation-post-transport";
import EditPromotionPage from "./page";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

// The member accepted the current posting terms before (the edit form shows
// no tick), unless a test serves them as not accepted yet.
const ALREADY_ACCEPTED = { acceptedAt: "2026-11-01T10:00:00.000Z" };

const { promotionDetailPreviewSpy } = vi.hoisted(() => ({
  promotionDetailPreviewSpy: vi.fn(),
}));

const planGateMock = vi.hoisted(() => ({
  maxPhotos: 5,
  maxVideos: 1,
  videoAllowed: true,
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useParams: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

// Call and WhatsApp use the account's verified number.
const authMock = vi.hoisted(() => ({ phone: "0821234567" as string | null }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, profile: { phone: authMock.phone }, isLoading: false }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="footer">Footer</footer>,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("@/components/listings/promotion-detail-content", () => ({
  PromotionDetailContent: (props: {
    promotion: { title: string };
    linkedBusiness: { business_name?: string | null } | null;
    layoutMode?: "public" | "review";
  }) => {
    promotionDetailPreviewSpy(props);
    return (
      <div>
        <div>Promotion Detail Preview</div>
        <div>{props.promotion.title}</div>
        <div>{props.linkedBusiness?.business_name ?? "No linked business"}</div>
      </div>
    );
  },
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) =>
    province === "Gauteng" ? ["Johannesburg", "Pretoria"] : [],
  getTownsForCity: (province: string, city: string) =>
    province === "Gauteng" && city === "Johannesburg" ? ["Noordwyk", "Midrand"] : [],
}));

vi.mock("@/components/billing/plan-gate", () => ({
  usePlanMaxPhotos: () => planGateMock.maxPhotos,
  usePlanMaxVideos: () => planGateMock.maxVideos,
  usePlanVideoAllowed: () => planGateMock.videoAllowed,
}));

describe("EditPromotionPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();
  let fetchMock: Mock;
  let termsLoaded: () => Promise<void>;
  let serveAcceptedAt: (value: string | null) => void;

  const createDefaultPromotion = (
    overrides: Partial<{
      photos: string[];
      videos: string[];
      video_thumbnail: string;
      business_id: string | null;
      event_details: Record<string, unknown>;
      price_cents: number | null;
      revision: number | null;
    }> = {}
  ) => ({
    id: "promotion-1",
    revision: 6,
    title: "Night Market",
    description: "Community event with food, music, and stalls.",
    promotion_type: "event",
    category: "Live Music",
    category_key: "events_entertainment",
    price_cents: 5000,
    price_negotiable: false,
    location_province: "Gauteng",
    location_city: "Johannesburg",
    contact_methods: ["call", "form"],
    start_date: "2099-03-10T00:00:00.000Z",
    end_date: "2099-03-12T00:00:00.000Z",
    photos: ["https://example.com/promo.jpg"],
    videos: [],
    video_thumbnail: "",
    business_id: "business-1",
    event_details: { event_type: "market_expo" },
    ...overrides,
  });

  function mockEditPromotionFetch(
    promotionOverrides: Partial<{
      photos: string[];
      videos: string[];
      video_thumbnail: string;
      business_id: string | null;
      price_cents: number | null;
      event_details: Record<string, unknown>;
      revision: number | null;
    }> = {}
  ) {
    ({
      api: fetchMock,
      termsLoaded,
      serveAcceptedAt,
    } = installFoundationPostFetch(
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            promotion: createDefaultPromotion(promotionOverrides),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            businesses: [{ id: "business-1", business_name: "Nomsa Kitchen" }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        }),
      ALREADY_ACCEPTED
    ));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    planGateMock.maxPhotos = 5;
    planGateMock.maxVideos = 1;
    planGateMock.videoAllowed = true;
    authMock.phone = "0821234567";
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ id: "promotion-1" });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    mockEditPromotionFetch();
  });

  it("keeps a saved free event as free entry and lets it be saved", async () => {
    mockEditPromotionFetch({ price_cents: 0, revision: 11 });
    render(<EditPromotionPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Night Market")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Free entry")).toBeChecked();
    expect(screen.queryByLabelText(/Entry price from/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    const payload = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(payload.price_zar).toBe(0);
    expectFoundationPostFields(payload, { expectedRevision: 11 });
  });

  it("shows no posting-terms tick while the current terms are accepted", async () => {
    render(<EditPromotionPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Night Market")).toBeInTheDocument());
    expect(screen.queryByLabelText(POSTING_TERMS_TICK)).toBeNull();
  });

  it("asks for the current terms when not accepted yet, and accepts them before saving", async () => {
    serveAcceptedAt(null);
    render(<EditPromotionPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Night Market")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    expect(
      (await screen.findAllByText("Accept the posting terms before submitting.")).length
    ).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByLabelText(POSTING_TERMS_TICK));
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expectTermsAcceptedBeforeSave("/api/promotions/promotion-1");
  });

  it("hydrates saved promotion details and sends normalized payload on save", async () => {
    render(<EditPromotionPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Night Market")).toBeInTheDocument();
    });

    expect(
      screen.getByDisplayValue("Community event with food, music, and stalls.")
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("50")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2099-03-10")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2099-03-12")).toBeInTheDocument();
    expect(screen.getByText("Event preview")).toBeInTheDocument();
    expect(screen.getByText("Promotion Detail Preview")).toBeInTheDocument();
    expect(screen.getAllByText("Nomsa Kitchen").length).toBeGreaterThan(0);
    expect(promotionDetailPreviewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutMode: "review" })
    );

    fireEvent.change(screen.getByLabelText(/Tickets URL/), {
      target: { value: "https:// tickets.example.com/night-market" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const request = fetchMock.mock.calls[2];
    const payload = JSON.parse(request[1].body as string);

    expect(request[0]).toBe("/api/promotions/promotion-1");
    expect(payload.title).toBe("Night Market");
    expect(payload.price_zar).toBe(50);
    expect(payload.contact_methods).toEqual(["call", "form"]);
    expect(payload.business_id).toBe("business-1");
    expect(payload.start_date).toBe("2099-03-10T00:00:00.000Z");
    expect(payload.end_date).toBe("2099-03-12T00:00:00.000Z");
    expect(payload.event_details.tickets_url).toBe("https://tickets.example.com/night-market");
    expectFoundationPostFields(payload, { expectedRevision: 6 });
  });

  it("keeps event details the form does not edit and saves website, map pin and socials", async () => {
    mockEditPromotionFetch({
      event_details: {
        event_type: "market_expo",
        recurring: "monthly",
        rain_policy: "moved_indoors",
        website: "https://nightmarket.example.com",
        social_links: { instagram: "https://instagram.com/nightmarket" },
      },
    });
    render(<EditPromotionPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://nightmarket.example.com")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("https://instagram.com/nightmarket")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Location pin (Google Maps link) (Optional)"), {
      target: { value: "maps.app.goo.gl/venue" },
    });
    fireEvent.change(screen.getByLabelText("Facebook (Optional)"), {
      target: { value: "facebook.com/nightmarket" },
    });
    // Recurring is no longer asked, but an edit keeps the saved answer.
    expect(screen.queryByLabelText("Recurring")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rain policy"), { target: { value: "postponed" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    const request = fetchMock.mock.calls[2];
    const payload = JSON.parse(request[1].body as string);

    expect(payload.event_details).toMatchObject({
      recurring: "monthly",
      rain_policy: "postponed",
      website: "https://nightmarket.example.com",
      map_directions: "https://maps.app.goo.gl/venue",
      social_links: {
        instagram: "https://instagram.com/nightmarket",
        facebook: "https://facebook.com/nightmarket",
      },
    });
  });

  it("reports a post loaded without its revision as a failed load", async () => {
    mockEditPromotionFetch({ revision: null });

    render(<EditPromotionPage />);

    expect(await screen.findByText("Failed to load Tourism & Events post")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Night Market")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/promotions/promotion-1",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("does not render a promotion type selector (events only)", async () => {
    render(<EditPromotionPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(screen.queryByLabelText("Promotion Type")).not.toBeInTheDocument();
  });

  it("allows saving a live promotion that only has video media", async () => {
    mockEditPromotionFetch({
      photos: [],
      videos: ["https://example.com/promo-video.mp4"],
      video_thumbnail: "https://example.com/promo-video-thumb.jpg",
    });

    render(<EditPromotionPage />);
    await termsLoaded();

    const saveButton = await screen.findByRole("button", { name: /Save Changes/i });
    expect(saveButton).toBeEnabled();
    expect(screen.queryByText("At least one photo or video is required.")).not.toBeInTheDocument();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const request = fetchMock.mock.calls[2];
    const payload = JSON.parse(request[1].body as string);

    // Group 129: the video's thumbnail becomes the first photo.
    expect(payload.images).toEqual(["https://example.com/promo-video-thumb.jpg"]);
    expect(payload.videos).toEqual(["https://example.com/promo-video.mp4"]);
    expect(payload.video_thumbnail).toBe("https://example.com/promo-video-thumb.jpg");
  });

  it("allows saving an existing video when the media entitlement check has not refreshed yet", async () => {
    planGateMock.videoAllowed = false;
    planGateMock.maxVideos = 0;
    mockEditPromotionFetch({
      photos: [],
      videos: ["https://example.com/promo-video.mp4"],
      video_thumbnail: "https://example.com/promo-video-thumb.jpg",
    });

    render(<EditPromotionPage />);
    await termsLoaded();

    const saveButton = await screen.findByRole("button", { name: /Save Changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    expect(
      screen.queryByText("Video upload is not available on your current plan.")
    ).not.toBeInTheDocument();
    const request = fetchMock.mock.calls[2];
    const payload = JSON.parse(request[1].body as string);
    expect(payload.videos).toEqual(["https://example.com/promo-video.mp4"]);
  });

  it("keeps unsaved changes on the form when an earlier promotion edit is pending", async () => {
    ({ api: fetchMock, termsLoaded } = installFoundationPostFetch(
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            promotion: createDefaultPromotion(),
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            businesses: [{ id: "business-1", business_name: "Nomsa Kitchen" }],
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          json: async () => ({ code: "pending_edit_exists" }),
        }),
      ALREADY_ACCEPTED
    ));

    render(<EditPromotionPage />);
    await termsLoaded();

    const saveButton = await screen.findByRole("button", { name: /Save Changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/Your latest changes were not submitted/)).toBeInTheDocument();
    });
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows a photo-or-video validation message when no media exists", async () => {
    mockEditPromotionFetch({
      photos: [],
      videos: [],
      video_thumbnail: "",
    });

    render(<EditPromotionPage />);

    expect(await screen.findByText("At least one photo or video is required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save Changes/i })).toBeDisabled();
  });
  it("round-trips the new event details and keeps answers the form no longer asks", async () => {
    mockEditPromotionFetch({
      event_details: {
        event_type: "market_expo",
        age_restriction: "18_plus",
        dress_code: "Smart casual",
        group_discount_available: true,
        doors_open: "17:30",
        ticket_sales: "both",
        gate_payment: ["card"],
        refund_policy: "full_until_days",
        refund_days: 5,
        social_links: { youtube: "https://youtube.com/@nightmarket" },
      },
    });
    render(<EditPromotionPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Night Market")).toBeInTheDocument());

    // Loaded and shown.
    expect(screen.getByLabelText("Doors open (Optional)")).toHaveValue("17:30");
    expect(screen.getByLabelText("Online and at the door")).toBeChecked();
    expect(screen.getByLabelText("Card")).toBeChecked();
    expect(screen.getByLabelText("Refunds (Optional)")).toHaveValue("full_until_days");
    expect(screen.getByLabelText(/Full refund until/)).toHaveValue(5);
    expect(screen.getByDisplayValue("https://youtube.com/@nightmarket")).toBeInTheDocument();
    expect(screen.getByText("ID will be checked at the door")).toBeInTheDocument();
    expect(
      screen.getByText("Ends at midnight? Choose the next day and 00:00.")
    ).toBeInTheDocument();
    expect(screen.getByText(/Video up to 1 min/)).toBeInTheDocument();
    // Removed inputs.
    expect(screen.queryByLabelText(/Dress Code/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Group discounts/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Cash"));
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const payload = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(payload.event_details).toMatchObject({
      doors_open: "17:30",
      ticket_sales: "both",
      gate_payment: ["card", "cash"],
      refund_policy: "full_until_days",
      refund_days: 5,
      dress_code: "Smart casual",
      group_discount_available: true,
      social_links: { youtube: "https://youtube.com/@nightmarket" },
    });
  });

  it("shows contact switches using the verified number, with no typed number", async () => {
    render(<EditPromotionPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Night Market")).toBeInTheDocument());

    expect(screen.getByRole("switch", { name: "Call" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "WhatsApp" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Contact form" })).toBeChecked();
    expect(screen.getByText("Enquiries arrive in your VerifyMzansi inbox")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Phone number/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "WhatsApp" }));
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const payload = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(payload.contact_methods).toEqual(["call", "form", "whatsapp"]);
  });

  it("does not send Call when the account has no verified number", async () => {
    authMock.phone = null;
    render(<EditPromotionPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Night Market")).toBeInTheDocument());

    expect(screen.getByRole("switch", { name: "Call" })).toBeDisabled();
    expect(screen.getAllByRole("link", { name: "Verify a number" }).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const payload = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(payload.contact_methods).toEqual(["form"]);
  });

  it("shows the entry as Free or Paid from R", async () => {
    render(<EditPromotionPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Night Market")).toBeInTheDocument());

    expect(screen.getByLabelText("Paid entry")).toBeChecked();
    expect(screen.getByLabelText("Entry price from (R)")).toHaveValue(50);
    expect(screen.queryByText(/This is separate from posting/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Free entry"));
    expect(screen.queryByLabelText("Entry price from (R)")).not.toBeInTheDocument();
    // Paid-only answers are hidden for a free event.
    expect(screen.queryByLabelText("Refunds (Optional)")).not.toBeInTheDocument();
  });
});
