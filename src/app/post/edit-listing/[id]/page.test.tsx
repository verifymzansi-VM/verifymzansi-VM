import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  expectFoundationPostFields,
  expectTermsAcceptedBeforeSave,
  installFoundationPostFetch,
  POSTING_TERMS_TICK,
} from "@/test/foundation-post-transport";
import EditListingPage from "./page";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

// The member accepted the current posting terms before (the edit form shows
// no tick), unless a test serves them as not accepted yet.
const ALREADY_ACCEPTED = { acceptedAt: "2026-11-01T10:00:00.000Z" };

const { mockMaybeSingle } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
}));
const { listingCardSpy } = vi.hoisted(() => ({
  listingCardSpy: vi.fn(),
}));
const { listingDetailPreviewSpy } = vi.hoisted(() => ({
  listingDetailPreviewSpy: vi.fn(),
}));
const { authState } = vi.hoisted(() => ({
  authState: { profile: { phone: "+27821234567" } as { phone: string | null } | null },
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, profile: authState.profile, isLoading: false }),
}));

// Uploads with a progress bar use XHR; these tests stub fetch, so send them there.
vi.mock("@/lib/utils/xhr-upload", () => ({
  xhrFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));

// The one allowance read the page makes (media limits and Save as template).
const { entitlements } = vi.hoisted(() => ({
  entitlements: { maxPhotos: 5, maxVideos: 1, videoAllowed: true, packageRunning: false },
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useParams: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn().mockResolvedValue("a".repeat(64)),
  withCsrfHeaders: (headers?: HeadersInit) => new Headers(headers),
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

vi.mock("@/components/billing/plan-gate", () => ({
  usePlanEntitlements: () => entitlements,
}));

vi.mock("@/components/listings/listing-detail-content", () => ({
  ListingDetailContent: (props: {
    listing: { title: string; attributes?: Record<string, unknown> };
    layoutMode?: "public" | "review";
  }) => {
    listingDetailPreviewSpy(props);
    return (
      <div>
        <div>Listing Detail Preview</div>
        <div>{props.listing.title}</div>
        {props.listing.attributes?.brand ? (
          <div>Brand {String(props.listing.attributes.brand)}</div>
        ) : null}
      </div>
    );
  },
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({
    label,
    onChange,
    existing = [],
    onRemoveExisting,
  }: {
    label: string;
    onChange?: (files: File[]) => void;
    existing?: { url: string; label?: string }[];
    onRemoveExisting?: (index: number) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onChange?.([new File(["mock"], "logo.png", { type: "image/png" })])}
      >
        {label}
      </button>
      {existing.map((item, index) => (
        <button key={item.url} type="button" onClick={() => onRemoveExisting?.(index)}>
          {`Remove ${item.label ?? item.url}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/listings/category-picker", () => ({
  CategoryPicker: () => <div>Category Picker</div>,
}));

vi.mock("@/components/listings/listing-card", () => ({
  ListingCard: (props: unknown) => {
    listingCardSpy(props);
    return <div>Listing Card Preview</div>;
  },
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) =>
    province === "Gauteng" ? ["Johannesburg", "Pretoria"] : [],
  getTownsForCity: () => [],
}));

// The page loads the owner's listing from the API; the test serves it from
// the same mock the supabase client used to.
vi.mock("./load-own-listing", () => ({
  loadOwnListing: async () => {
    const { data, error } = await mockMaybeSingle();
    return { data: data ?? null, error: error ?? null };
  },
}));

vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  }),
}));

describe("EditListingPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();
  let fetchMock: Mock;
  let termsLoaded: () => Promise<void>;
  let serveAcceptedAt: (value: string | null) => void;
  let terms: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    entitlements.packageRunning = false;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "listing-1",
        seller_id: "user-1",
        status: "live",
        revision: 4,
        title: "Used iPhone 15",
        description: "Clean phone in excellent condition.",
        price_cents: 150000,
        category: "electronics",
        condition: "used",
        attributes: { device_type: "Smartphone", brand: "Apple", storage_gb: 256 },
        location_province: "Gauteng",
        location_city: "Johannesburg",
        location_suburb: "Sandton",
        price_negotiable: true,
        contact_methods: ["call", "whatsapp"],
        photos: ["https://media.verifymzansi.com/listings/photo.jpg"],
        videos: [],
        video_thumbnail: null,
        logo_url: "https://media.verifymzansi.com/listings/existing-logo.jpg",
      },
      error: null,
    });
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      push: mockPush,
      back: vi.fn(),
    });
    (useParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ id: "listing-1" });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });

    ({
      api: fetchMock,
      terms,
      termsLoaded,
      serveAcceptedAt,
    } = installFoundationPostFetch(
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, pendingReview: true }),
      }),
      ALREADY_ACCEPTED
    ));
    global.URL.createObjectURL = vi.fn(() => "blob:new-logo-preview");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("shows no posting-terms tick while the current terms are accepted", async () => {
    render(<EditListingPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Used iPhone 15")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Save as template" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(POSTING_TERMS_TICK)).toBeNull();
  });

  it("Save as template follows the allowance and sends no request of its own", async () => {
    const { unmount } = render(<EditListingPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Used iPhone 15")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Save as template" })).toBeNull();
    unmount();

    entitlements.packageRunning = true;
    render(<EditListingPage />);
    expect(await screen.findByRole("button", { name: "Save as template" })).toBeInTheDocument();
    // Only the posting-terms reads reach the network; the page sends no template read.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the current terms when not accepted yet, and accepts them before saving", async () => {
    serveAcceptedAt(null);
    render(<EditListingPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Used iPhone 15")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    expect(
      (await screen.findAllByText("Accept the posting terms before submitting.")).length
    ).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(POSTING_TERMS_TICK));
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/listings"));
    expectTermsAcceptedBeforeSave("/api/listings/listing-1");
  });

  it("when accepting the terms is refused, says so and uploads and saves nothing", async () => {
    serveAcceptedAt(null);
    render(<EditListingPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Used iPhone 15")).toBeInTheDocument());
    // A new logo waits to be uploaded.
    fireEvent.click(screen.getByRole("button", { name: "Listing logo (optional)" }));
    fireEvent.click(screen.getByLabelText(POSTING_TERMS_TICK));
    terms.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    expect(
      await screen.findByText(
        "The posting terms could not be accepted. Refresh this form and try again."
      )
    ).toBeInTheDocument();
    expect(terms).toHaveBeenCalledWith(
      "/api/foundation/posting-terms",
      expect.objectContaining({ method: "POST" })
    );
    // No upload and no save request.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not claim a saved update was submitted without server confirmation", async () => {
    render(<EditListingPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Used iPhone 15")).toBeInTheDocument());
    fetchMock
      .mockReset()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Listing updated!" }))
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Edit submitted for review" })
    );
  });

  it("hydrates saved listing details and sends normalized payload on save", async () => {
    render(<EditListingPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Used iPhone 15")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Clean phone in excellent condition.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1500")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sandton")).toBeInTheDocument();
    expect(screen.getByText("Listing preview")).toBeInTheDocument();
    expect(screen.getByText("Listing Detail Preview")).toBeInTheDocument();
    expect(screen.getByText("Brand Apple")).toBeInTheDocument();
    expect(listingDetailPreviewSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutMode: "review" })
    );
    expect(listingCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "https://media.verifymzansi.com/listings/existing-logo.jpg",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Edit submitted for review", variant: "success" })
    );
    expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");

    const request = fetchMock.mock.calls[0];
    const payload = JSON.parse(request[1].body as string);

    expect(request[0]).toBe("/api/listings/listing-1");
    expect(payload.title).toBe("Used iPhone 15");
    expect(payload.price_zar).toBe(1500);
    expect(payload.price_mode).toBe("amount");
    expect(payload.negotiable).toBe(true);
    expect(payload.town).toBe("Sandton");
    expect(payload.contactMethods).toEqual(["call", "whatsapp", "in_app"]);
    expect(payload.logo_url).toBe("https://media.verifymzansi.com/listings/existing-logo.jpg");
    expect(payload.attributes).toMatchObject({ brand: "Apple", storage_gb: 256 });
    expectFoundationPostFields(payload, { expectedRevision: 4 });
  });

  it("opens a Price on request post with no amount and saves it unchanged", async () => {
    const { data } = await mockMaybeSingle();
    mockMaybeSingle.mockResolvedValue({
      data: { ...data, price_mode: "on_request", price_cents: null, price_negotiable: true },
      error: null,
    });
    render(<EditListingPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Price on request" })).toBeChecked();
    });
    expect(screen.queryByLabelText("Asking price (ZAR)")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Price negotiable" })).toBeChecked();
    expect(listingCardSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ price: 0, priceMode: "on_request" })
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload).toMatchObject({ price_mode: "on_request", price_zar: 0, negotiable: true });
  });

  it("opens an existing Free post (price 0) with Free selected", async () => {
    const { data } = await mockMaybeSingle();
    mockMaybeSingle.mockResolvedValue({
      data: { ...data, price_mode: "free", price_cents: 0, price_negotiable: false },
      error: null,
    });
    render(<EditListingPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Free" })).toBeChecked();
    });
    expect(screen.queryByLabelText("Asking price (ZAR)")).not.toBeInTheDocument();
  });

  it("switches a priced post to Free and drops the amount and Negotiable", async () => {
    render(<EditListingPage />);
    await termsLoaded();
    await waitFor(() => {
      expect(screen.getByDisplayValue("1500")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("radio", { name: "Free" }));
    expect(screen.queryByRole("checkbox", { name: "Price negotiable" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload).toMatchObject({ price_mode: "free", price_zar: 0, negotiable: false });
  });

  it("allows removing the existing listing logo before save", async () => {
    render(<EditListingPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove Current logo" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove Current logo" }));
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0];
    const payload = JSON.parse(request[1].body as string);

    expect(payload.logo_url).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Current logo" })).not.toBeInTheDocument();
  });

  it("keeps unsaved changes and explains that a post in review cannot be edited yet", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: "You can edit this post after it has been reviewed.",
        reason: "post_in_review",
      }),
    });

    render(<EditListingPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Used iPhone 15")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(
        screen.getByText("You can edit this post after it has been reviewed.")
      ).toBeInTheDocument();
    });
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not reuse the old video's cover frame when the saved video is swapped", async () => {
    const frame = "https://media.verifymzansi.com/listings/old-frame.jpg";
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "listing-1",
        seller_id: "user-1",
        status: "live",
        revision: 4,
        title: "Used iPhone 15",
        description: "Clean phone in excellent condition.",
        price_cents: 150000,
        category: "electronics",
        condition: "used",
        attributes: { device_type: "Smartphone", brand: "Apple", storage_gb: 256 },
        location_province: "Gauteng",
        location_city: "Johannesburg",
        location_suburb: "Sandton",
        price_negotiable: true,
        contact_methods: ["call", "whatsapp"],
        photos: [frame],
        videos: ["https://media.verifymzansi.com/listings/old.mp4"],
        video_thumbnail: frame,
        logo_url: null,
      },
      error: null,
    });
    render(<EditListingPage />);
    await termsLoaded();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Video \(max 1\)/ })).toBeInTheDocument();
    });

    // A new video replaces the saved one and no new cover is picked.
    fireEvent.click(screen.getByRole("button", { name: /Video \(max 1\)/ }));
    // The old frame is no longer listed as a photo, so the screen matches what is saved.
    expect(screen.queryByRole("button", { name: "Remove Photo 1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(await screen.findByText("Please fix the highlighted fields.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/listings/listing-1")).toHaveLength(
      0
    );
  });

  it("lists only the other photos once the saved video is swapped", async () => {
    const frame = "https://media.verifymzansi.com/listings/old-frame.jpg";
    const other = "https://media.verifymzansi.com/listings/other.jpg";
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "listing-1",
        seller_id: "user-1",
        status: "live",
        revision: 4,
        title: "Used iPhone 15",
        description: "Clean phone in excellent condition.",
        price_cents: 150000,
        category: "electronics",
        condition: "used",
        attributes: { device_type: "Smartphone", brand: "Apple", storage_gb: 256 },
        location_province: "Gauteng",
        location_city: "Johannesburg",
        location_suburb: "Sandton",
        price_negotiable: true,
        contact_methods: ["call", "whatsapp"],
        photos: [frame, other],
        videos: ["https://media.verifymzansi.com/listings/old.mp4"],
        video_thumbnail: frame,
        logo_url: null,
      },
      error: null,
    });
    render(<EditListingPage />);
    await termsLoaded();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove Photo 2" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Video \(max 1\)/ }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove Photo 2" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Remove Photo 1" })).toBeInTheDocument();
  });

  it("uploads and uses a replacement listing logo", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({
            urls: ["https://media.verifymzansi.com/listings/replaced-logo.jpg"],
          }),
        };
      }

      if (input === "/api/listings/listing-1") {
        return {
          ok: true,
          json: async () => ({ success: true, pendingReview: true }),
        };
      }

      throw new Error(`Unexpected fetch call: ${String(input)}`);
    });

    render(<EditListingPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Listing logo (optional)" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Listing logo (optional)" }));

    expect(listingCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "blob:new-logo-preview",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const request = fetchMock.mock.calls[1];
    const payload = JSON.parse(request[1].body as string);

    expect(payload.logo_url).toBe("https://media.verifymzansi.com/listings/replaced-logo.jpg");
    expectFoundationPostFields(payload, { expectedRevision: 4 });
  });

  it("does not open the form for a listing loaded without its revision", async () => {
    const loaded = await mockMaybeSingle();
    mockMaybeSingle.mockResolvedValue({ ...loaded, data: { ...loaded.data, revision: null } });

    render(<EditListingPage />);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to load listing" })
      );
    });
    expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");
    expect(screen.queryByRole("button", { name: /Save Changes/i })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a safe fallback when the listing fails to load", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "PGRST301" },
    });

    render(<EditListingPage />);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to load listing" })
      );
    });

    expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");
    expect(screen.getByText("Unable to load listing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to listings/i })).toBeInTheDocument();
  });

  describe("contacts, links and Market answers", () => {
    async function openWith(extra: Record<string, unknown>) {
      const { data } = await mockMaybeSingle();
      mockMaybeSingle.mockResolvedValue({ data: { ...data, ...extra }, error: null });
      render(<EditListingPage />);
      await termsLoaded();
      await waitFor(() => expect(screen.getByDisplayValue("Used iPhone 15")).toBeInTheDocument());
    }

    async function saveAndReadPayload() {
      fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      return JSON.parse(fetchMock.mock.calls[0][1].body as string);
    }

    beforeEach(() => {
      authState.profile = { phone: "+27821234567" };
    });

    it("shows the contact switches with the masked verified number", async () => {
      await openWith({});
      expect(screen.getByRole("switch", { name: "Phone call" })).toBeChecked();
      expect(screen.getByRole("switch", { name: "WhatsApp" })).toBeChecked();
      expect(screen.getByRole("switch", { name: "Private enquiry" })).toBeDisabled();
      expect(screen.getAllByText(/Your verified number 08• ••• 4567/)).toHaveLength(2);
      fireEvent.click(screen.getByRole("switch", { name: "WhatsApp" }));
      const payload = await saveAndReadPayload();
      expect(payload.contactMethods).toEqual(["call", "in_app"]);
    });

    it("loads the saved website and social links and saves them back", async () => {
      await openWith({
        website: "https://shop.example.co.za",
        social_links: { facebook: "https://facebook.com/shop", youtube: "https://youtube.com/@s" },
      });
      expect(screen.getByDisplayValue("https://shop.example.co.za")).toBeInTheDocument();
      expect(screen.getByDisplayValue("https://facebook.com/shop")).toBeInTheDocument();
      expect(screen.getByDisplayValue("https://youtube.com/@s")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/^Instagram/), {
        target: { value: "https://instagram.com/shop" },
      });
      const payload = await saveAndReadPayload();
      expect(payload.website).toBe("https://shop.example.co.za");
      expect(payload.social_links).toEqual({
        facebook: "https://facebook.com/shop",
        instagram: "https://instagram.com/shop",
        youtube: "https://youtube.com/@s",
      });
    });

    it("round-trips the new Market answers and reads an older post's pets yes/no as the choice", async () => {
      await openWith({
        category: "property",
        condition: null,
        attributes: {
          property_type: "house",
          listing_intent: "rent",
          pets_allowed: false,
          available_from: "2026-12-01",
          deposit_zar: 9000,
          lease_term: "6_months",
          utilities_included: ["water"],
        },
      });
      const payload = await saveAndReadPayload();
      expect(payload.attributes).toMatchObject({
        pets_policy: "not_allowed",
        pets_allowed: false,
        available_from: "2026-12-01",
        deposit_zar: 9000,
        lease_term: "6_months",
        utilities_included: ["water"],
      });
    });

    it("keeps clothing size, gender and how the buyer gets it on save", async () => {
      await openWith({
        category: "clothing_accessories",
        attributes: { size: "M", gender: "women", delivery_methods: ["collect", "courier"] },
      });
      const payload = await saveAndReadPayload();
      expect(payload.attributes).toEqual({
        size: "M",
        gender: "women",
        delivery_methods: ["collect", "courier"],
      });
    });

    it("shows the media limits by the upload buttons", async () => {
      await openWith({});
      expect(
        screen.getByText("Photos up to 5 MB · Video up to 2 min, up to 300 MB")
      ).toBeInTheDocument();
    });
  });
});
