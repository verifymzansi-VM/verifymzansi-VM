import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateTourismPage from "./page";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";
import { compressVideoForUpload, VideoTranscodeError } from "@/lib/media/compress-before-upload";

const { mediaFilesByLabel, lastPromotionCardProps } = vi.hoisted(() => ({
  mediaFilesByLabel: new Map<string, File[]>(),
  lastPromotionCardProps: { current: null as Record<string, unknown> | null },
}));
const { businessPreviewProps, promotionPreviewProps } = vi.hoisted(() => ({
  businessPreviewProps: { current: null as Record<string, unknown> | null },
  promotionPreviewProps: { current: null as Record<string, unknown> | null },
}));
const { searchParamGetMock } = vi.hoisted(() => ({
  searchParamGetMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: searchParamGetMock }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { location_province: "Gauteng", location_city: "Johannesburg" },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-post-draft-autosave", () => ({
  usePostDraftAutosave: () => ({
    save: vi.fn(),
    restore: vi.fn().mockReturnValue(null),
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
  PostFormScaffold: ({
    children,
    footer,
    error,
  }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
    error?: string | null;
  }) => (
    <div>
      {error ? <div>{error}</div> : null}
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

vi.mock("@/lib/media/compress-before-upload", () => ({
  compressVideoForUpload: vi.fn(async (file: File) => file),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mediaFilesByLabel.clear();
    lastPromotionCardProps.current = null;
    searchParamGetMock.mockReturnValue(null);
    global.URL.createObjectURL = vi.fn(() => "blob:tourism-preview");
    global.URL.revokeObjectURL = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" }),
    }) as unknown as typeof fetch;
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true)
    );
  });

  it("preserves shared fields and clears tourism-specific fields on confirmed switch", () => {
    render(<CreateTourismPage />);

    fireEvent.change(screen.getByLabelText("Business Name *"), {
      target: { value: "Kruger Sunset Lodge" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A beautiful place for travel and nature stays in South Africa." },
    });
    fireEvent.change(screen.getByLabelText("Tourism Category"), {
      target: { value: "hotel_resort" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));

    expect(screen.getByLabelText("Event Title *")).toHaveValue("Kruger Sunset Lodge");
    expect(screen.getByLabelText("Description *")).toHaveValue(
      "A beautiful place for travel and nature stays in South Africa."
    );

    fireEvent.click(screen.getByRole("button", { name: /Tourism Business/ }));

    expect(screen.getByLabelText("Tourism Category")).toHaveValue("");
  });

  it("does not switch listing type when confirmation is cancelled", () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false)
    );

    render(<CreateTourismPage />);

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));

    expect(screen.getByLabelText("Business Name *")).toBeInTheDocument();
    expect(screen.queryByLabelText("Event Title *")).not.toBeInTheDocument();
  });

  it("honors the canonical event creation query param on first render", () => {
    searchParamGetMock.mockImplementation((key: string) => (key === "type" ? "event" : null));

    render(<CreateTourismPage />);

    expect(screen.getByLabelText("Event Title *")).toBeInTheDocument();
    expect(screen.queryByLabelText("Business Name *")).not.toBeInTheDocument();
  });

  it("maps event API 422 photo-limit errors to the media step", async () => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/promotions") {
          return {
            ok: false,
            status: 422,
            json: async () => ({ error: "Maximum 10 photos allowed on your plan" }),
          };
        }

        return {
          ok: true,
          json: async () => ({ id: "ok" }),
        };
      }
    );

    render(<CreateTourismPage />);

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));
    fireEvent.change(screen.getByLabelText("Event Title *"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event Type"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start Date *"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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
      expect(screen.getAllByText("Maximum 10 photos allowed on your plan").length).toBeGreaterThan(
        0
      );
      expect(screen.getByText(/Please fix 1 field on Step 4/i)).toBeInTheDocument();
    });
  });

  it("maps event API 422 video-limit errors to the media step", async () => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/promotions") {
          return {
            ok: false,
            status: 422,
            json: async () => ({ error: "Video upload is not available on your current plan." }),
          };
        }

        return {
          ok: true,
          json: async () => ({ id: "ok" }),
        };
      }
    );

    render(<CreateTourismPage />);

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));
    fireEvent.change(screen.getByLabelText("Event Title *"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event Type"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start Date *"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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
        screen.getAllByText("Video upload is not available on your current plan.").length
      ).toBeGreaterThan(0);
      expect(screen.getByText(/Please fix 1 field on Step 4/i)).toBeInTheDocument();
    });
  });

  it("maps tourism business API 422 photo-limit errors to the media step", async () => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/businesses") {
          return {
            ok: false,
            status: 422,
            json: async () => ({ error: "Maximum 10 gallery photos allowed on your plan" }),
          };
        }

        return {
          ok: true,
          json: async () => ({ id: "ok" }),
        };
      }
    );

    render(<CreateTourismPage />);

    fireEvent.change(screen.getByLabelText("Business Name *"), {
      target: { value: "Kruger Sunset Lodge" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: {
        value: "A detailed tourism business description with enough content to pass validation.",
      },
    });
    fireEvent.change(screen.getByLabelText("Tourism Category"), {
      target: { value: "hotel_resort" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText("Maximum 10 gallery photos allowed on your plan").length
      ).toBeGreaterThan(0);
      expect(screen.getByText(/Please fix 1 field on Step 4/i)).toBeInTheDocument();
    });
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

    fireEvent.change(screen.getByLabelText("Business Name *"), {
      target: { value: "Kruger Sunset Lodge" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: {
        value: "A detailed tourism business description with enough content to pass validation.",
      },
    });
    fireEvent.change(screen.getByLabelText("Tourism Category"), {
      target: { value: "hotel_resort" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Booking URL"), {
      target: { value: "https:// www.booking.co.za" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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
    fireEvent.change(screen.getByLabelText("Website"), {
      target: { value: "https:// www.kruger.example" },
    });
    fireEvent.change(screen.getByPlaceholderText("Facebook URL"), {
      target: { value: "https:// facebook.com/kruger" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/businesses",
        expect.objectContaining({ method: "POST" })
      );
    });

    const businessCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([input]) => input === "/api/businesses"
    );
    const body = JSON.parse(String(businessCall?.[1]?.body));

    expect(body.social_links).toEqual({
      facebook: "https://facebook.com/kruger",
    });
    expect(body.category_details.booking_url).toBe("https://www.booking.co.za");
  });

  it("maps tourism business API 422 video-limit errors to the media step", async () => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        urls: ["https://media.verifymzansi.com/tourism/photo.jpg"],
        errors: [],
      }),
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/businesses") {
          return {
            ok: false,
            status: 422,
            json: async () => ({ error: "Video upload is not available on your current plan." }),
          };
        }

        return {
          ok: true,
          json: async () => ({ id: "ok" }),
        };
      }
    );

    render(<CreateTourismPage />);

    fireEvent.change(screen.getByLabelText("Business Name *"), {
      target: { value: "Kruger Sunset Lodge" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: {
        value: "A detailed tourism business description with enough content to pass validation.",
      },
    });
    fireEvent.change(screen.getByLabelText("Tourism Category"), {
      target: { value: "hotel_resort" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Upload photos/i }));
    acceptPostingTerms();
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText("Video upload is not available on your current plan.").length
      ).toBeGreaterThan(0);
      expect(screen.getByText(/Please fix 1 field on Step 4/i)).toBeInTheDocument();
    });
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
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
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
      }
    );

    render(<CreateTourismPage />);

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));
    fireEvent.change(screen.getByLabelText("Event Title *"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event Type"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start Date *"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/promotions",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(
            '"videos":["https://media.verifymzansi.com/promotion/video.mp4"]'
          ),
        })
      );
    });

    const promotionCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([input]) => input === "/api/promotions"
    );
    expect(promotionCall).toBeTruthy();
    const requestBody = JSON.parse(String(promotionCall?.[1]?.body ?? "{}")) as {
      images?: string[];
      videos?: string[];
    };
    expect(requestBody.images).toEqual([]);
    expect(requestBody.videos).toEqual(["https://media.verifymzansi.com/promotion/video.mp4"]);
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
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
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
      }
    );

    render(<CreateTourismPage />);

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));
    fireEvent.change(screen.getByLabelText("Event Title *"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event Type"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start Date *"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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

    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/promotions",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("marks the event preview card as video media for blob-based uploads", async () => {
    mediaFilesByLabel.set("Upload video", [new File(["video"], "clip.mp4", { type: "video/mp4" })]);

    render(<CreateTourismPage />);

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));
    fireEvent.change(screen.getByLabelText("Event Title *"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event Type"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start Date *"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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

    render(<CreateTourismPage />);

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));
    fireEvent.change(screen.getByLabelText("Event Title *"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event Type"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start Date *"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("maps photo upload network failures back to the tourism media step", async () => {
    (fetchWithRetry as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    );

    render(<CreateTourismPage />);

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));
    fireEvent.change(screen.getByLabelText("Event Title *"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event Type"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start Date *"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("surfaces a direct video error when MOV transcode fails", async () => {
    mediaFilesByLabel.set("Upload video", [
      new File(["video"], "clip.mov", { type: "video/quicktime" }),
    ]);
    (compressVideoForUpload as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new VideoTranscodeError(
        "This MOV video could not be converted to MP4. Export it as MP4 and try again."
      )
    );

    render(<CreateTourismPage />);

    fireEvent.click(screen.getByRole("button", { name: /Event/ }));
    fireEvent.change(screen.getByLabelText("Event Title *"), {
      target: { value: "Soweto Food Festival" },
    });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A detailed event description with enough content to pass validation." },
    });
    fireEvent.change(screen.getByLabelText("Event Type"), {
      target: { value: "festival_concert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Start Date *"), {
      target: { value: "2099-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

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
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
