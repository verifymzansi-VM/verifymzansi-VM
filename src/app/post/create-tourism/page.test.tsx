import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  expectFoundationPostFields,
  installFoundationPostFetch,
} from "@/test/foundation-post-transport";
import CreateTourismPage from "./page";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { prepareVideoUpload, VideoTranscodeError } from "@/lib/media/compress-before-upload";
import { checkUploadServiceReachable } from "@/lib/utils/upload-preflight";
import { readVideoLengthSeconds } from "@/lib/media/video-length-client";

const { restoreDraftMock } = vi.hoisted(() => ({ restoreDraftMock: vi.fn() }));

const { mediaFilesByLabel, lastPromotionCardProps } = vi.hoisted(() => ({
  mediaFilesByLabel: new Map<string, File[]>(),
  lastPromotionCardProps: { current: null as Record<string, unknown> | null },
}));
const { businessPreviewProps, promotionPreviewProps } = vi.hoisted(() => ({
  businessPreviewProps: { current: null as Record<string, unknown> | null },
  promotionPreviewProps: { current: null as Record<string, unknown> | null },
}));
const { searchParamGetMock, routerPushMock } = vi.hoisted(() => ({
  searchParamGetMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

// Uploads with a progress bar use XHR; these tests stub fetch, so send them there.
vi.mock("@/lib/utils/xhr-upload", () => ({
  xhrFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  useSearchParams: () => ({ get: searchParamGetMock }),
}));

// jsdom cannot read real video headers: the test clips are 30 s long.
vi.mock("@/lib/media/video-length-client", () => ({
  checkPickedVideoLength: vi.fn(async () => null),
  readVideoLengthSeconds: vi.fn(async () => 30),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: {
      location_province: "Gauteng",
      location_city: "Johannesburg",
      phone: "0821234567",
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-post-draft-autosave", () => ({
  usePostDraftAutosave: () => ({
    save: vi.fn(),
    restore: restoreDraftMock,
    discard: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header>Header</header>,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer>Footer</footer>,
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

vi.mock("@/components/business/layouts/business-layout-router", () => ({
  BusinessLayoutRouter: (props: {
    business: { business_name?: string };
    layoutMode?: "public" | "review";
  }) => {
    businessPreviewProps.current = props;
    return <div>Business Preview: {props.business.business_name ?? "preview"}</div>;
  },
}));

vi.mock("@/components/listings/promotion-card", () => ({
  PromotionCard: (props: Record<string, unknown>) => {
    lastPromotionCardProps.current = props;
    return <div>Promotion Card Preview</div>;
  },
}));

vi.mock("@/components/listings/promotion-detail-content", () => ({
  PromotionDetailContent: (props: {
    promotion: { title?: string };
    layoutMode?: "public" | "review";
  }) => {
    promotionPreviewProps.current = props;
    return <div>Event Preview: {props.promotion.title ?? "preview"}</div>;
  },
}));

vi.mock("@/components/billing/plan-gate", () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePlanMaxPhotos: () => 10,
  usePlanMaxVideos: () => 3,
  usePlanVideoAllowed: () => true,
}));

vi.mock("@/components/post/post-form-scaffold", () => ({
  PostDraftStatus: ({ onDiscard }: { onDiscard: () => void }) => (
    <button type="button" onClick={onDiscard}>
      Discard draft
    </button>
  ),
  PostFormSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  ),
  PostFormScaffold: ({
    children,
    footer,
    error,
    errorAction,
  }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
    error?: string | null;
    errorAction?: React.ReactNode;
  }) => (
    <div>
      {error ? <div>{error}</div> : null}
      {errorAction}
      {children}
      {footer}
    </div>
  ),
  PostFormFooter: ({
    currentStep,
    totalSteps,
    onBack,
    onNext,
  }: {
    currentStep: number;
    totalSteps: number;
    onBack?: () => void;
    onNext?: () => void;
  }) => (
    <div>
      <button type="button" onClick={onBack}>
        Back
      </button>
      {currentStep === totalSteps - 1 ? (
        <button type="submit">Submit for review</button>
      ) : (
        <button type="button" onClick={onNext}>
          Next
        </button>
      )}
    </div>
  ),
}));

vi.mock("@/components/ui/location-selector", () => ({
  LocationSelector: ({
    value,
    onChange,
  }: {
    value: { province: string; city: string; town?: string; address?: string };
    onChange: (value: { province: string; city: string; town?: string; address?: string }) => void;
  }) => (
    <div>
      <label>
        Province
        <input
          aria-label="Province"
          value={value.province}
          onChange={(e) => onChange({ ...value, province: e.target.value })}
        />
      </label>
      <label>
        City
        <input
          aria-label="City"
          value={value.city}
          onChange={(e) => onChange({ ...value, city: e.target.value })}
        />
      </label>
      <label>
        Town
        <input
          aria-label="Town"
          value={value.town ?? ""}
          onChange={(e) => onChange({ ...value, town: e.target.value })}
        />
      </label>
      <label>
        Street address
        <input
          aria-label="Street address"
          value={value.address ?? ""}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
        />
      </label>
    </div>
  ),
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({
    label,
    error,
    onChange,
  }: {
    label: string;
    error?: string;
    onChange?: (files: File[]) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          const configuredFiles = mediaFilesByLabel.get(label);
          const files = configuredFiles ?? [
            new File(["mock"], label.toLowerCase().includes("video") ? "clip.mp4" : "photo.png", {
              type: label.toLowerCase().includes("video") ? "video/mp4" : "image/png",
            }),
          ];
          onChange?.(files);
        }}
      >
        Add media for {label}
      </button>
      {error ? <p>{error}</p> : null}
    </div>
  ),
}));

// A submit made before a cover was chosen takes a frame from the prepared video.
vi.mock("@/lib/media/video-frame", () => ({
  extractVideoFrame: vi.fn(
    async (file: File) => new File(["frame"], `${file.name}_poster.jpg`, { type: "image/jpeg" })
  ),
}));

vi.mock("@/lib/media/compress-before-upload", () => ({
  prepareVideoUpload: vi.fn(async (file: File) => ({ file, source: "kept" })),
  VideoTranscodeError: class VideoTranscodeError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "VideoTranscodeError";
    }
  },
}));

vi.mock("@/components/ui/video-frame-selector", () => ({
  VideoFrameSelector: () => <div>Video Frame Selector</div>,
}));

vi.mock("@/components/ui/media-crop-preview", () => ({
  MediaCropPreview: () => <div>Media Crop Preview</div>,
}));

vi.mock("@/components/ui/operating-hours-input", () => ({
  OperatingHoursInput: () => <div>Hours Input</div>,
  formatHoursValue: () => "",
  parseHoursValue: () => ({ open: "", close: "", closed: false }),
}));

vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn().mockResolvedValue("csrf-token"),
  withCsrfHeaders: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/utils/fetch-retry", () => ({
  fetchWithRetry: vi.fn(),
}));

vi.mock("@/lib/utils/upload-preflight", () => ({
  checkUploadServiceReachable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/utils/media-metadata", () => ({
  readMediaDimensions: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/post-drafts/defaults", () => ({
  getDefaultEventDates: vi.fn().mockReturnValue({ startDate: "", endDate: "" }),
}));

/** Tick the posting-terms checkbox shown on the review step before submitting. */
function acceptPostingTerms() {
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I accept the VerifyMzansi posting terms/i })
  );
}

describe("CreateTourismPage type switch behavior", () => {
  let fetchMock: Mock;
  let postingTermsFetch: Mock;
  let termsLoaded: () => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreDraftMock.mockReturnValue(null);
    mediaFilesByLabel.clear();
    lastPromotionCardProps.current = null;
    searchParamGetMock.mockReturnValue(null);
    global.URL.createObjectURL = vi.fn(() => "blob:tourism-preview");
    global.URL.revokeObjectURL = vi.fn();
    ({
      api: fetchMock,
      terms: postingTermsFetch,
      termsLoaded,
    } = installFoundationPostFetch(
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "ok" }) })
    ));
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true)
    );
  });

  it("does not repeat the route selection inside the form", () => {
    render(<CreateTourismPage />);
    expect(screen.queryByRole("button", { name: /^Event$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Tourism Business$/ })).not.toBeInTheDocument();
  });

  it.each([
    ["tourism_business", "Name of your stay or activity (Required)", 100, 3000],
    ["event", "Event name (Required)", 120, 5000],
  ])(
    "shows and enforces the %s text limits",
    async (type, nameLabel, nameLimit, descriptionLimit) => {
      searchParamGetMock.mockImplementation((key: string) => (key === "type" ? type : null));
      await act(async () => {
        render(<CreateTourismPage />);
      });
      const name = screen.getByLabelText(nameLabel);
      const description = screen.getByLabelText("Description (Required)");

      expect(name).toHaveAttribute("maxlength", String(nameLimit));
      expect(description).toHaveAttribute("maxlength", String(descriptionLimit));
      expect(name).toHaveAccessibleDescription(`0 of ${nameLimit} characters`);
      expect(description).toHaveAccessibleDescription(`0 of ${descriptionLimit} characters`);

      await act(async () => {
        fireEvent.change(name, { target: { value: "t".repeat(nameLimit + 1) } });
        fireEvent.change(description, { target: { value: "d".repeat(descriptionLimit + 1) } });
      });

      expect(name).toHaveValue("t".repeat(nameLimit));
      expect(description).toHaveValue("d".repeat(descriptionLimit));
      expect(screen.getByText(`${nameLimit}/${nameLimit}`)).toBeInTheDocument();
      expect(screen.getByText(`${descriptionLimit}/${descriptionLimit}`)).toBeInTheDocument();
      expect(name).toHaveAccessibleDescription(`${nameLimit} of ${nameLimit} characters`);
      expect(description).toHaveAccessibleDescription(
        `${descriptionLimit} of ${descriptionLimit} characters`
      );
    }
  );

  it.each([
    [101, 3000, "Title cannot exceed 100 characters."],
    [100, 3001, "Description cannot exceed 3 000 characters."],
  ])(
    "blocks a restored tourism draft with title=%i description=%i before uploading",
    async (titleLength, descriptionLength, message) => {
      restoreDraftMock.mockReturnValue({
        step: 3,
        data: {
          listingType: "tourism_business",
          title: "t".repeat(titleLength),
          description: "d".repeat(descriptionLength),
          subcategory: "hotel_resort",
          province: "Gauteng",
          city: "Johannesburg",
          locationAddress: "24 Vilakazi Street",
          locationTown: "Orlando West",
          contactMethods: ["form"],
        },
      });
      render(<CreateTourismPage />);
      await screen.findByRole("button", { name: /Submit for review/i });
      fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
      acceptPostingTerms();
      fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

      await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0));
      const invalidField = screen.getByLabelText(
        titleLength > 100 ? "Name of your stay or activity (Required)" : "Description (Required)"
      );
      expect(invalidField).toHaveAttribute("aria-invalid", "true");
      expect(invalidField).toHaveAccessibleDescription(expect.stringContaining(message));
      expect(checkUploadServiceReachable).not.toHaveBeenCalled();
      expect(fetchWithRetry).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("a late draft restore fills empty fields but keeps text already typed", async () => {
    let finish: (draft: unknown) => void = () => {};
    restoreDraftMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<CreateTourismPage />);
    const name = screen.getByLabelText("Name of your stay or activity (Required)");
    fireEvent.change(name, { target: { value: "Typed Lodge" } });
    await act(async () => {
      finish({
        step: 0,
        data: {
          listingType: "tourism_business",
          title: "Saved Lodge",
          description: "A saved description for the lodge by the lagoon.",
        },
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Description (Required)")).toHaveValue(
        "A saved description for the lodge by the lagoon."
      )
    );
    expect(name).toHaveValue("Typed Lodge");
  });

  it("honors the canonical event creation query param on first render", () => {
    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));

    render(<CreateTourismPage />);

    expect(screen.getByLabelText("Event name (Required)")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Name of your stay or activity (Required)")
    ).not.toBeInTheDocument();
  });

  /** Fills an event up to the media step (Step 4). */
  function fillEventToMediaStep() {
    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByLabelText("Free entry"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  /** Fills a tourism business up to the media step (Step 4). */
  function fillTourismBusinessToMediaStep() {
    render(<CreateTourismPage />);
    fireEvent.change(screen.getByLabelText("Name of your stay or activity (Required)"), {
      target: { value: "Kruger Sunset Lodge" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: {
        value: "A detailed tourism business description with enough content to pass validation.",
      },
    });
    fireEvent.change(screen.getByLabelText("Tourism category (Required)"), {
      target: { value: "hotel_resort" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.change(screen.getByLabelText("Street address"), {
      target: { value: "24 Vilakazi Street" },
    });
    fireEvent.change(screen.getByLabelText("Town"), { target: { value: "Orlando West" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  it.each([
    ["event", "photo", "/api/promotions", "Maximum 10 photos allowed on your plan"],
    ["event", "video", "/api/promotions", "Video upload is not available on your current plan."],
    [
      "tourism business",
      "photo",
      "/api/businesses",
      "Maximum 10 gallery photos allowed on your plan",
    ],
    [
      "tourism business",
      "video",
      "/api/businesses",
      "Video upload is not available on your current plan.",
    ],
  ])("maps %s API 422 %s-limit errors to the media step", async (kind, _limit, endpoint, error) => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      input === endpoint
        ? { ok: false, status: 422, json: async () => ({ error }) }
        : { ok: true, json: async () => ({ id: "ok" }) }
    );

    if (kind === "event") fillEventToMediaStep();
    else fillTourismBusinessToMediaStep();
    await termsLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(screen.getAllByText(error).length).toBeGreaterThan(0);
      expect(screen.getByText(/Please fix 1 field on Step 4/i)).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: "POST" }));
  });

  it("does not submit before the posting terms have loaded", async () => {
    postingTermsFetch.mockReturnValue(new Promise(() => {}));
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });

    fillEventToMediaStep();
    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(await screen.findByText(/Posting terms are still loading/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("persists tourism business social links and normalized booking URLs", async () => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });

    render(<CreateTourismPage />);
    await termsLoaded();

    fireEvent.change(screen.getByLabelText("Name of your stay or activity (Required)"), {
      target: { value: "Kruger Sunset Lodge" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: {
        value: "A detailed tourism business description with enough content to pass validation.",
      },
    });
    fireEvent.change(screen.getByLabelText("Tourism category (Required)"), {
      target: { value: "hotel_resort" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Booking URL (Optional)"), {
      target: { value: "https:// www.booking.co.za" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Johannesburg" },
    });
    fireEvent.change(screen.getByLabelText("Street address"), {
      target: { value: "24 Vilakazi Street" },
    });
    fireEvent.change(screen.getByLabelText("Town"), {
      target: { value: "Orlando West" },
    });
    fireEvent.click(screen.getByLabelText("Show my exact visitor address publicly"));
    fireEvent.change(screen.getByLabelText("Website (Optional)"), {
      target: { value: "https:// www.kruger.example" },
    });
    fireEvent.change(screen.getByLabelText("Facebook (Optional)"), {
      target: { value: "https:// facebook.com/kruger" },
    });
    fireEvent.change(screen.getByLabelText("Location pin (Google Maps link) (Optional)"), {
      target: { value: "maps.app.goo.gl/kruger" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/businesses",
        expect.objectContaining({ method: "POST" })
      );
    });

    const businessCall = fetchMock.mock.calls.find(([input]) => input === "/api/businesses");
    const body = JSON.parse(String(businessCall?.[1]?.body));

    expect(body.social_links).toEqual({
      facebook: "https://facebook.com/kruger",
    });
    expect(body.category_details.booking_url).toBe("https://www.booking.co.za");
    expect(body.map_directions).toBe("https://maps.app.goo.gl/kruger");
    expect(body.category_details.customer_access.publishAddress).toBe(true);
    expect(body.termsAccepted).toBe(true);
    expectFoundationPostFields(body);
  });

  it("keeps the address private by default, fills the profile number and saves SA details for an attraction", async () => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });

    render(<CreateTourismPage />);
    await termsLoaded();

    fireEvent.change(screen.getByLabelText("Name of your stay or activity (Required)"), {
      target: { value: "Soweto Heritage Museum" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A museum about the history of Soweto, open to visitors every day." },
    });
    fireEvent.change(screen.getByLabelText("Tourism category (Required)"), {
      target: { value: "cultural_heritage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("TGCSA Grading"), { target: { value: "4_star" } });
    fireEvent.change(screen.getByLabelText(/^Minimum stay/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Call uses the verified account number (shown masked); nothing is typed.
    expect(screen.queryByLabelText(/Phone number/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/WhatsApp Number/)).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Call" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "WhatsApp" })).not.toBeChecked();
    expect(screen.getAllByText(/Your verified number 08/).length).toBe(2);
    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();
    // Attractions are fixed venues: no "How do visitors join" question.
    expect(screen.queryByText(/How do visitors join/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Street address"), {
      target: { value: "8115 Vilakazi Street" },
    });
    // Without "Show my exact visitor address publicly" there is no map pin to add.
    expect(
      screen.queryByLabelText("Location pin (Google Maps link) (Optional)")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/businesses",
        expect.objectContaining({ method: "POST" })
      );
    });
    const businessCall = fetchMock.mock.calls.find(([input]) => input === "/api/businesses");
    const body = JSON.parse(String(businessCall?.[1]?.body));
    expect(body.category_details.customer_access.publishAddress).toBe(false);
    expect(body.map_directions).toBeUndefined();
    expect(body).not.toHaveProperty("email");
    expect(body.phone).toBe("0821234567");
    expect(body.whatsapp).toBeUndefined();
    expect(body.contact_methods).toEqual(["call"]);
    expect(body.category_details.tgcsa_grading).toBe("4_star");
    expect(body.category_details.minimum_stay_nights).toBe(2);
  });

  it("allows event submit with video only", async () => {
    mediaFilesByLabel.set("Upload video", [new File(["video"], "clip.mp4", { type: "video/mp4" })]);

    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/media/upload") {
          return {
            ok: true,
            json: async () => ({
              urls: ["https://media.verifymzansi.com/promotion/video.mp4"],
              errors: [],
            }),
          };
        }

        throw new Error(`Unexpected fetchWithRetry call: ${String(input)}`);
      }
    );
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/promotions") {
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, promotion: { id: "promo-1" } }),
        };
      }

      return {
        ok: true,
        json: async () => ({ id: "ok" }),
      };
    });

    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    await termsLoaded();
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByLabelText("Free entry"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload video/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/promotions",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(
            '"videos":["https://media.verifymzansi.com/promotion/video.mp4"]'
          ),
        })
      );
    });

    const promotionCall = fetchMock.mock.calls.find(([input]) => input === "/api/promotions");
    expect(promotionCall).toBeTruthy();
    const requestBody = JSON.parse(String(promotionCall?.[1]?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    // No thumbnail was chosen: a frame of the video is taken at submit and saved as photo 1
    // (this mock answers every upload with the same URL).
    expect(requestBody.images).toHaveLength(1);
    expect(requestBody.video_thumbnail).toBe(
      requestBody.images && (requestBody.images as string[])[0]
    );
    expect(requestBody.videos).toEqual(["https://media.verifymzansi.com/promotion/video.mp4"]);
    expectFoundationPostFields(requestBody);
  });

  it("blocks event submit when validated video upload fails", async () => {
    mediaFilesByLabel.set("Upload video", [new File(["video"], "clip.mp4", { type: "video/mp4" })]);

    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/media/upload") {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              urls: [],
              errors: ["clip.mp4: file content does not match declared video type"],
            }),
          };
        }

        throw new Error(`Unexpected fetchWithRetry call: ${String(input)}`);
      }
    );
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/promotions") {
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, promotion: { id: "promo-1" } }),
        };
      }

      return {
        ok: true,
        json: async () => ({ id: "ok" }),
      };
    });

    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    await termsLoaded();
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByLabelText("Free entry"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload video/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText(
          "Selected media could not be uploaded. Retry the highlighted files and try again."
        ).length
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText("clip.mp4: file content does not match declared video type").length
      ).toBeGreaterThan(0);
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/promotions",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it.each([
    { shown: false, expected: null, street: "" },
    { shown: true, expected: "24 Vilakazi Street", street: "24 Vilakazi Street" },
  ])(
    "preview shows the street address only when the public-address switch is on (on: $shown)",
    async ({ shown, expected, street }) => {
      render(<CreateTourismPage />);
      await termsLoaded();

      fireEvent.change(screen.getByLabelText("Name of your stay or activity (Required)"), {
        target: { value: "Kruger Sunset Lodge" },
      });
      fireEvent.change(screen.getByLabelText("Description (Required)"), {
        target: {
          value: "A detailed tourism business description with enough content to pass validation.",
        },
      });
      fireEvent.change(screen.getByLabelText("Tourism category (Required)"), {
        target: { value: "hotel_resort" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      fireEvent.click(screen.getByRole("switch", { name: "Call" }));
      fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
      fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
      fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
      fireEvent.change(screen.getByLabelText("Street address"), {
        target: { value: "24 Vilakazi Street" },
      });
      fireEvent.change(screen.getByLabelText("Town"), { target: { value: "Orlando West" } });
      if (shown) fireEvent.click(screen.getByLabelText("Show my exact visitor address publicly"));
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));

      await waitFor(() => {
        expect(businessPreviewProps.current).not.toBeNull();
      });
      const business = (businessPreviewProps.current as { business: Record<string, unknown> })
        .business as {
        location_address: string | null;
        business_details: { street_address: string };
      };
      expect(business.location_address).toBe(expected);
      expect(business.business_details.street_address).toBe(street);
    }
  );

  it("marks the event preview card as video media for blob-based uploads", async () => {
    mediaFilesByLabel.set("Upload video", [new File(["video"], "clip.mp4", { type: "video/mp4" })]);

    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByLabelText("Free entry"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload video/i }));

    await waitFor(() => {
      expect(lastPromotionCardProps.current).toMatchObject({
        imageUrl: "blob:tourism-preview",
        isVideo: true,
      });
    });
    expect(businessPreviewProps.current).toEqual(expect.objectContaining({ layoutMode: "review" }));
    expect(promotionPreviewProps.current).toEqual(
      expect.objectContaining({ layoutMode: "review" })
    );
  });

  it("blocks event submit when photo upload returns partial success", async () => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 207,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: ['"photo-2.jpg": upload failed'],
      }),
    });

    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    await termsLoaded();
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByLabelText("Free entry"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText("One or more photos failed to upload. Retry the selected files.").length
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(
          "Selected media could not be uploaded. Retry the highlighted files and try again."
        ).length
      ).toBeGreaterThan(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps photo upload network failures back to the tourism media step", async () => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    );

    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    await termsLoaded();
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByLabelText("Free entry"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText(
          "We couldn't reach the upload service. Check your connection and try again."
        ).length
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(
          "Selected media could not be uploaded. Retry the highlighted files and try again."
        ).length
      ).toBeGreaterThan(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a direct video error when MOV transcode fails", async () => {
    mediaFilesByLabel.set("Upload video", [
      new File(["video"], "clip.mov", { type: "video/quicktime" }),
    ]);
    // Both the background preparation on pick and the attempt at submit fail
    // (the submit checks the video's length first, so it starts its own attempt).
    const transcodeFailure = new VideoTranscodeError(
      "This MOV video could not be converted to MP4. Export it as MP4 and try again."
    );
    (prepareVideoUpload as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(transcodeFailure)
      .mockRejectedValueOnce(transcodeFailure);

    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    await termsLoaded();
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByLabelText("Free entry"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), {
      target: { value: "Gauteng" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload video/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText(
          "This MOV video could not be converted to MP4. Export it as MP4 and try again."
        ).length
      ).toBeGreaterThan(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a 90 s video at submit when the post is an event (1-minute limit)", async () => {
    mediaFilesByLabel.set("Upload video", [new File(["video"], "clip.mp4", { type: "video/mp4" })]);
    // Read once when the pick starts its background conversion, once at submit.
    vi.mocked(readVideoLengthSeconds).mockResolvedValueOnce(90).mockResolvedValueOnce(90);

    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    await termsLoaded();
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByLabelText("Free entry"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload video/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText("Your video is 1 min 30 s; the limit is 1 minute.").length
      ).toBeGreaterThan(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  async function fillAndSubmitEvent(promotionsResponse: { status: number; body: unknown }) {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/promotions") {
        return {
          ok: false,
          status: promotionsResponse.status,
          json: async () => promotionsResponse.body,
        };
      }
      return { ok: true, json: async () => ({ id: "ok" }) };
    });

    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    await termsLoaded();
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByLabelText("Free entry"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("switch", { name: "Call" }));
    fireEvent.click(screen.getByRole("switch", { name: "Contact form" }));
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
  }

  it("offers a sign-in link back to this page when the event session expired (401)", async () => {
    window.history.pushState({}, "", "/post/create-tourism?type=event");
    await fillAndSubmitEvent({ status: 401, body: { error: "Unauthorized" } });

    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute(
      "href",
      `/login?returnUrl=${encodeURIComponent("/post/create-tourism?type=event")}`
    );
    expect(screen.getByText(/re-attach your photos and videos/i)).toBeInTheDocument();
    expect(routerPushMock).not.toHaveBeenCalled();
    window.history.pushState({}, "", "/");
  });

  it("names the first step of the event form for an event type server error", async () => {
    await fillAndSubmitEvent({
      status: 422,
      body: {
        error: "Choose one of the options.",
        reason: "invalid_post",
        issues: [{ path: "event_details.event_type", message: "Choose one of the options." }],
      },
    });

    expect(await screen.findByText(/Please fix 1 field on Step 1/i)).toBeInTheDocument();
  });

  it("does not follow an off-site event redirectUrl", async () => {
    await fillAndSubmitEvent({ status: 403, body: { redirectUrl: "//evil.example/phish" } });

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/dashboard/listings");
    });
    expect(routerPushMock).not.toHaveBeenCalledWith("//evil.example/phish");
  });
  /** Uploads succeed, and the business and promotion APIs accept the post. */
  function acceptEverySubmit() {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ success: true, id: "ok" }),
    }));
  }

  function postedBody(endpoint: string) {
    const call = fetchMock.mock.calls.find(([input]) => input === endpoint);
    return JSON.parse(String(call?.[1]?.body ?? "{}"));
  }

  /** Step 1 of a tourism business with the given category, then Next. */
  function startTourismBusiness(subcategory: string) {
    render(<CreateTourismPage />);
    fireEvent.change(screen.getByLabelText("Name of your stay or activity (Required)"), {
      target: { value: "Kruger Sunset Lodge" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: {
        value: "A detailed tourism business description with enough content to pass validation.",
      },
    });
    fireEvent.change(screen.getByLabelText("Tourism category (Required)"), {
      target: { value: subcategory },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  /** Step 3 (location and contact) to the review step, then submit. */
  function finishTourismBusiness() {
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
  }

  it("folds optional stay details, asks for a From price and stay sizes, and saves them", async () => {
    acceptEverySubmit();
    startTourismBusiness("guest_house_bnb");
    await termsLoaded();

    // The price bands and the duplicate star rating are gone; TGCSA stays.
    expect(screen.queryByLabelText(/Price range/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Official star grading/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("TGCSA Grading")).toBeInTheDocument();
    // Optional inputs sit under a closed "More details (optional)".
    const more = screen.getByText("More details (optional)").closest("details");
    expect(more).not.toHaveAttribute("open");
    expect(more).toContainElement(screen.getByLabelText("Booking URL (Optional)"));
    expect(more).not.toContainElement(screen.getByLabelText("Price (Optional)"));
    // At most one "Help me choose" per topic.
    const helps = screen.getAllByRole("button", { name: /^Help with/ });
    const topics = helps.map((button) => button.getAttribute("aria-label"));
    expect(new Set(topics).size).toBe(topics.length);
    expect(helps.length).toBeLessThanOrEqual(3);

    fireEvent.change(screen.getByLabelText("Price (Optional)"), { target: { value: "450" } });
    expect(screen.getByLabelText("Price is")).toHaveValue("night");
    fireEvent.change(screen.getByLabelText("Sleeps (Optional)"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Bedrooms (Optional)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Beds (Optional)"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Bathrooms (Optional)"), { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText("Inverter or solar"));
    fireEvent.click(screen.getByLabelText("Water tanks"));
    fireEvent.change(screen.getByRole("combobox", { name: "Cancellation policy" }), {
      target: { value: "free_until_days" },
    });
    // The days are required for this choice.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByText("Enter the number of days (1 to 365).").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/Free cancellation until/), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Stays are fixed venues: no "How do visitors join" question.
    expect(screen.queryByText(/How do visitors join/)).not.toBeInTheDocument();
    finishTourismBusiness();

    await waitFor(() => expect(screen.getByText("Submitted")).toBeInTheDocument());
    const details = postedBody("/api/businesses").category_details;
    expect(details).toMatchObject({
      price_from_cents: 45000,
      price_unit: "night",
      sleeps: 4,
      bedrooms: 2,
      beds: 3,
      bathrooms: 1,
      backup_utilities: ["inverter_solar", "water_tanks"],
      cancellation_policy: "free_until_days",
      cancellation_free_days: 7,
    });
    expect(details).not.toHaveProperty("price_range");
    expect(details).not.toHaveProperty("star_rating");
  });

  it("asks a tour how visitors join, and saves a per-person price", async () => {
    acceptEverySubmit();
    startTourismBusiness("tour_operator");
    await termsLoaded();
    expect(screen.getByLabelText("Price is")).toHaveValue("person");
    expect(screen.queryByLabelText(/Sleeps/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Price (Optional)"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText(/How do visitors join your tour or experience/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("At a meeting point"));
    fireEvent.change(screen.getByLabelText(/^Meeting point/), {
      target: { value: "Outside the museum" },
    });
    finishTourismBusiness();

    await waitFor(() => expect(screen.getByText("Submitted")).toBeInTheDocument());
    const details = postedBody("/api/businesses").category_details;
    expect(details).toMatchObject({ price_from_cents: 30000, price_unit: "person" });
  });

  it("saves an attraction's entry fee and opening hours line instead of weekly hours", async () => {
    acceptEverySubmit();
    startTourismBusiness("tourist_attraction");
    await termsLoaded();
    expect(screen.getByLabelText("Price is")).toHaveValue("entry");
    fireEvent.change(screen.getByLabelText("Price (Optional)"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Opening hours (Optional)"), {
      target: { value: "Daily 08:00 to 17:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByText("Hours Input")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("YouTube (Optional)"), {
      target: { value: "youtube.com/@museum" },
    });
    finishTourismBusiness();

    await waitFor(() => expect(screen.getByText("Submitted")).toBeInTheDocument());
    const body = postedBody("/api/businesses");
    expect(body.category_details).toMatchObject({
      price_from_cents: 8000,
      price_unit: "entry",
      opening_hours: "Daily 08:00 to 17:00",
    });
    expect(body.social_links).toEqual({ youtube: "https://youtube.com/@museum" });
    expect(body.operating_hours).toBeUndefined();
  });

  it("shows the Submitted screen with the post In review instead of leaving the page", async () => {
    acceptEverySubmit();
    fillEventToMediaStep();
    await termsLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(await screen.findByRole("heading", { name: "Submitted" })).toBeInTheDocument();
    expect(
      screen.getByText("Our team reviews every post before it goes live.")
    ).toBeInTheDocument();
    expect(screen.getByText("Soweto Food Festival")).toBeInTheDocument();
    expect(screen.getByText("In review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to My posts" })).toHaveAttribute(
      "href",
      "/dashboard/listings?area=PROMOTIONS_EVENTS"
    );
    expect(screen.queryByRole("button", { name: /Submit for review/i })).not.toBeInTheDocument();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("saves a paid event's entry, doors, tickets, door payment, refunds and YouTube link", async () => {
    acceptEverySubmit();
    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));
    render(<CreateTourismPage />);
    await termsLoaded();
    fireEvent.change(screen.getByLabelText("Event name (Required)"), {
      target: { value: "Soweto Jazz Night" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event category (Required)"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(
      screen.getByText("Ends at midnight? Choose the next day and 00:00.")
    ).toBeInTheDocument();
    // Removed inputs.
    expect(screen.queryByLabelText(/Dress Code/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Recurring/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Group discounts/)).not.toBeInTheDocument();
    // The old two-sentence entry explanation is gone.
    expect(screen.queryByText(/Free to post describes the listing fee/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Start date (Required)"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Start time (Required)"), {
      target: { value: "18:00" },
    });
    fireEvent.change(screen.getByLabelText("Doors open (Optional)"), {
      target: { value: "17:30" },
    });
    fireEvent.click(screen.getByLabelText("Paid entry"));
    fireEvent.change(screen.getByLabelText("Entry price from (R)"), { target: { value: "150" } });
    fireEvent.click(screen.getByLabelText("At the door"));
    fireEvent.click(screen.getByLabelText("Cash"));
    fireEvent.change(screen.getByLabelText("Refunds (Optional)"), {
      target: { value: "full_until_days" },
    });
    fireEvent.change(screen.getByLabelText(/Full refund until/), { target: { value: "3" } });
    expect(screen.queryByText("ID will be checked at the door")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Age restriction/), { target: { value: "18_plus" } });
    expect(screen.getByText("ID will be checked at the door")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("switch", { name: "WhatsApp" }));
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.change(screen.getByLabelText("YouTube (Optional)"), {
      target: { value: "https://youtube.com/@jazznight" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Video up to 1 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => expect(screen.getByText("Submitted")).toBeInTheDocument());
    const body = postedBody("/api/promotions");
    expect(body.price_zar).toBe(150);
    expect(body.contact_methods).toEqual(["call", "whatsapp"]);
    expect(body.event_details).toMatchObject({
      doors_open: "17:30",
      ticket_sales: "door",
      gate_payment: ["cash"],
      refund_policy: "full_until_days",
      refund_days: 3,
      age_restriction: "18_plus",
      social_links: { youtube: "https://youtube.com/@jazznight" },
    });
    expect(body.event_details).not.toHaveProperty("dress_code");
    expect(body.event_details).not.toHaveProperty("recurring");
    expect(body.event_details).not.toHaveProperty("group_discount_available");
  });
});
