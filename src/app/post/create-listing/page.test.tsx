import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import CreateListingPage from "./page";
import type * as HiddenFeatures from "@/lib/hidden-features";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import {
  SERVED_POSTING_TERMS,
  expectFoundationPostFields,
  installFoundationPostFetch,
} from "@/test/foundation-post-transport";

const switches = vi.hoisted(() => ({ SHOW_POST_TEMPLATES: false, SHOW_POST_COPY: false }));
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  get SHOW_POST_TEMPLATES() {
    return switches.SHOW_POST_TEMPLATES;
  },
  get SHOW_POST_COPY() {
    return switches.SHOW_POST_COPY;
  },
}));

type MockAuthState = {
  user: { id: string; email?: string | null } | null;
  profile: Record<string, unknown> | null;
  isLoading: boolean;
};

const { listingCardSpy, useAuthMock } = vi.hoisted(() => ({
  listingCardSpy: vi.fn(),
  useAuthMock: vi.fn<() => MockAuthState>(() => ({
    user: null,
    profile: null,
    isLoading: false,
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn().mockReturnValue("/post/create-listing"),
  useSearchParams: vi.fn(() => new URLSearchParams(window.location.search)),
}));

// jsdom cannot read real video headers: the test clips are 30 s long.
vi.mock("@/lib/media/video-length-client", () => ({
  checkPickedVideoLength: vi.fn(async () => null),
  readVideoLengthSeconds: vi.fn(async () => 30),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: useAuthMock,
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

vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn().mockResolvedValue("a".repeat(64)),
  withCsrfHeaders: (headers?: HeadersInit) => new Headers(headers),
}));

vi.mock("@/lib/utils/upload-preflight", () => ({
  checkUploadServiceReachable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/media/compress-before-upload", () => ({
  compressVideoForUpload: vi.fn(async (file: File) => file),
  VideoTranscodeError: class VideoTranscodeError extends Error {
    constructor(message = "Video transcode failed") {
      super(message);
      this.name = "VideoTranscodeError";
    }
  },
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

vi.mock("@/components/billing/plan-gate", () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePlanMaxPhotos: () => 5,
  usePlanMaxVideos: () => 1,
  usePlanVideoAllowed: () => true,
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="footer">Footer</footer>,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock("@/components/listings/category-picker", () => ({
  CategoryPicker: ({
    value,
    onChange,
    onAttributeChange,
  }: {
    value: string;
    onChange: (value: string) => void;
    onAttributeChange: (name: string, value: string | boolean) => void;
  }) => (
    <div data-testid="category-picker" data-value={value}>
      <button
        type="button"
        onClick={() => {
          onChange("electronics");
          onAttributeChange("device_type", "Smartphone");
          onAttributeChange("brand", "Apple");
        }}
      >
        Select Electronics
      </button>
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
        onClick={() =>
          onChange?.([
            new File(["mock"], label.toLowerCase().includes("video") ? "clip.mp4" : "logo.png", {
              type: label.toLowerCase().includes("video") ? "video/mp4" : "image/png",
            }),
          ])
        }
      >
        {label}
      </button>
      {error ? <p>{error}</p> : null}
    </div>
  ),
}));

vi.mock("@/components/ui/video-frame-selector", () => ({
  VideoFrameSelector: () => <div data-testid="video-frame-selector" />,
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

vi.mock("@/lib/utils/format", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatZAR: (cents: number) => `R ${(cents / 100).toFixed(2)}`,
}));

describe("CreateListingPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();
  let fetchMock: Mock;
  let postingTermsFetch: Mock;
  let termsLoaded: () => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    mockToast.mockReturnValue({ id: "toast", dismiss: vi.fn(), update: vi.fn() });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    global.URL.createObjectURL = vi.fn(() => "blob:logo-preview");
    global.URL.revokeObjectURL = vi.fn();
    ({
      api: fetchMock,
      terms: postingTermsFetch,
      termsLoaded,
    } = installFoundationPostFetch(
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    ));
  });

  function acceptListingTerms() {
    fireEvent.click(screen.getByLabelText(/I accept the VerifyMzansi posting terms/i));
  }

  it("renders the shared guide and step labels", () => {
    render(<CreateListingPage />);

    const stepNav = screen.getByRole("navigation", { name: "Mzansi Market creation steps" });

    expect(screen.getByText("Quick guide")).toBeInTheDocument();
    expect(within(stepNav).getAllByText("What are you listing?").length).toBeGreaterThan(0);
    expect(within(stepNav).getAllByText("Price, location & contact").length).toBeGreaterThan(0);
    expect(within(stepNav).getAllByText("Photos & review").length).toBeGreaterThan(0);
  });

  it("preselects the category chosen on the post chooser", async () => {
    window.history.replaceState(null, "", "/post/create-listing?category=vehicles");

    try {
      render(<CreateListingPage />);

      await waitFor(() => {
        expect(screen.getByTestId("category-picker")).toHaveAttribute("data-value", "vehicles");
      });
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("shows inline validation instead of only using toast errors", () => {
    render(<CreateListingPage />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getAllByText("Select a category.").length).toBeGreaterThan(0);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("shows the shared final action label on the last step", () => {
    render(<CreateListingPage />);

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
  });

  it("renders saved category attributes inside the shared listing preview", () => {
    render(<CreateListingPage />);

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText(/Listing preview/i)).toBeInTheDocument();
    expect(document.querySelector('[data-layout-mode="review"]')).not.toBeNull();
    expect(screen.getByText("Brand")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText(/Electronics/i)).toBeInTheDocument();
  });

  it("previews and submits an uploaded listing logo", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/media/upload") {
        const callIndex = fetchMock.mock.calls.length;
        return {
          ok: true,
          json: async () =>
            callIndex === 1
              ? { urls: ["https://media.verifymzansi.com/listings/logo.jpg"] }
              : { urls: ["https://media.verifymzansi.com/listings/photo.jpg"], errors: [] },
        };
      }

      if (input === "/api/listings") {
        return {
          ok: true,
          json: async () => ({ id: "listing-1" }),
        };
      }

      throw new Error(`Unexpected fetch call: ${String(input)}`);
    });

    render(<CreateListingPage />);
    await termsLoaded();

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Listing logo (optional)" }));
    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));
    acceptListingTerms();

    expect(listingCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "blob:logo-preview",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      expect(calls.some((call) => call[0] === "/api/listings")).toBe(true);
    });

    const request = fetchMock.mock.calls.find((call) => call[0] === "/api/listings");
    expect(request).toBeDefined();
    if (!request) {
      throw new Error("Expected /api/listings submission call");
    }
    const payload = JSON.parse(request[1].body as string);

    expect(payload.logo_url).toBe("https://media.verifymzansi.com/listings/logo.jpg");
    expect(payload.images).toEqual(["https://media.verifymzansi.com/listings/photo.jpg"]);
    expect(payload.termsAccepted).toBe(true);
    expectFoundationPostFields(payload);
    expect(postingTermsFetch).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");
  });

  it("blocks saving when the server rejects a selected photo", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/media/upload") {
        const callIndex = fetchMock.mock.calls.length;
        return {
          ok: true,
          json: async () =>
            callIndex === 1
              ? { urls: ["https://media.verifymzansi.com/listings/logo.jpg"] }
              : { urls: [], errors: ["The selected photo was rejected"] },
        };
      }

      if (input === "/api/listings") {
        return {
          ok: true,
          json: async () => ({ id: "listing-1" }),
        };
      }

      throw new Error(`Unexpected fetch call: ${String(input)}`);
    });

    render(<CreateListingPage />);
    await termsLoaded();

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Listing logo (optional)" }));
    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));
    acceptListingTerms();

    expect(listingCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "blob:logo-preview",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    expect(await screen.findAllByText("The selected photo was rejected")).not.toHaveLength(0);
    const calls = fetchMock.mock.calls;
    expect(calls.some((call) => call[0] === "/api/listings")).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled();
  });

  it("maps API 422 photo-limit errors to listing media field errors", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({ urls: ["https://media.verifymzansi.com/listings/photo.jpg"] }),
        };
      }

      if (input === "/api/listings") {
        return {
          ok: false,
          status: 422,
          json: async () => ({ error: "Maximum 5 photos allowed on your plan" }),
        };
      }

      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    });

    render(<CreateListingPage />);
    await termsLoaded();

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));
    acceptListingTerms();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => {
      expect(screen.getAllByText("Maximum 5 photos allowed on your plan").length).toBeGreaterThan(
        0
      );
      expect(screen.getByText(/Please fix 1 field on Step 3/i)).toBeInTheDocument();
    });
  });

  it("maps API 422 video-limit errors to listing media field errors", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({ urls: ["https://media.verifymzansi.com/listings/photo.jpg"] }),
        };
      }

      if (input === "/api/listings") {
        return {
          ok: false,
          status: 422,
          json: async () => ({ error: "Video upload is not available on your current plan." }),
        };
      }

      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    });

    render(<CreateListingPage />);
    await termsLoaded();

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));
    acceptListingTerms();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => {
      expect(
        screen.getAllByText("Video upload is not available on your current plan.").length
      ).toBeGreaterThan(0);
      expect(screen.getByText(/Please fix 1 field on Step 3/i)).toBeInTheDocument();
    });
  });

  it("uploads listing videos through the validated upload endpoint only", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/media/upload") {
        const area = init?.body instanceof FormData ? init.body.get("area") : null;
        return {
          ok: true,
          status: 200,
          json: async () =>
            area === "listing_video"
              ? { urls: ["https://media.verifymzansi.com/listings/clip.mp4"], errors: [] }
              : { urls: ["https://media.verifymzansi.com/listings/photo.jpg"], errors: [] },
        };
      }

      if (input === "/api/listings") {
        return {
          ok: true,
          json: async () => ({ id: "listing-1" }),
        };
      }

      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    });

    render(<CreateListingPage />);
    await termsLoaded();

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));
    fireEvent.click(screen.getByRole("button", { name: "Video (max 1)" }));
    acceptListingTerms();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      expect(calls.some((call) => call[0] === "/api/listings")).toBe(true);
    });

    const calls = fetchMock.mock.calls;
    expect(calls.some((call) => String(call[0]).startsWith("/api/media/upload-"))).toBe(false);
    expect(
      calls.some(
        (call) =>
          call[0] === "/api/media/upload" &&
          call[1]?.body instanceof FormData &&
          call[1].body.get("area") === "listing_video"
      )
    ).toBe(true);

    const request = calls.find((call) => call[0] === "/api/listings");
    expect(request).toBeDefined();
    if (!request) {
      throw new Error("Expected /api/listings submission call");
    }
    const payload = JSON.parse(request[1].body as string);
    expect(payload.videos).toEqual(["https://media.verifymzansi.com/listings/clip.mp4"]);
    expectFoundationPostFields(payload);
  });

  it("keeps users on the media step with a videos field error when listing video upload fails", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/media/upload") {
        const area = init?.body instanceof FormData ? init.body.get("area") : null;
        if (area === "listing_video") {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              success: false,
              urls: [],
              errors: ['"clip.mp4": file content does not match declared video type'],
              traceId: "trace-video-1",
            }),
            headers: new Headers(),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            urls: ["https://media.verifymzansi.com/listings/photo.jpg"],
            errors: [],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    });

    render(<CreateListingPage />);
    await termsLoaded();

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));
    fireEvent.click(screen.getByRole("button", { name: "Video (max 1)" }));
    acceptListingTerms();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => {
      expect(
        screen.getAllByText(/file content does not match declared video type.*trace-video-1/i)
          .length
      ).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Selected listing media could not be uploaded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalledWith("/dashboard/listings");
  });

  it("redirects to complete profile when API returns phone-gate 403 redirectUrl", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({ urls: ["https://media.verifymzansi.com/listings/photo.jpg"] }),
        };
      }

      if (input === "/api/listings") {
        return {
          ok: false,
          status: 403,
          json: async () => ({ redirectUrl: "/dashboard/complete-profile" }),
        };
      }

      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    });

    render(<CreateListingPage />);
    await termsLoaded();

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));
    acceptListingTerms();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/complete-profile");
    });
  });

  it("shows plan-limit reason when API returns 403 reason", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({ urls: ["https://media.verifymzansi.com/listings/photo.jpg"] }),
        };
      }

      if (input === "/api/listings") {
        return {
          ok: false,
          status: 403,
          json: async () => ({ reason: "You reached your plan posting limit." }),
        };
      }

      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    });

    render(<CreateListingPage />);
    await termsLoaded();

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));
    acceptListingTerms();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => {
      expect(screen.getByText("You reached your plan posting limit.")).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  function mockListingSubmitResponse(response: { status: number; body: unknown }) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({ urls: ["https://media.verifymzansi.com/listings/photo.jpg"] }),
        };
      }
      if (input === "/api/listings") {
        return { ok: false, status: response.status, json: async () => response.body };
      }
      return { ok: true, json: async () => ({ success: true }) };
    });
  }

  function fillAndSubmitListing() {
    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title (Required)"), {
      target: { value: "Used iPhone 15" },
    });
    fireEvent.change(screen.getByLabelText("Description (Required)"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText(/^(Asking price|Monthly Rent) \(ZAR\)/i), {
      target: { value: "1500" },
    });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));
    acceptListingTerms();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
  }

  it("does not submit before the posting terms have loaded", async () => {
    postingTermsFetch.mockReturnValue(new Promise(() => {}));
    mockListingSubmitResponse({ status: 500, body: { error: "unexpected" } });

    render(<CreateListingPage />);
    fillAndSubmitListing();

    expect(await screen.findByText(/Posting terms are still loading/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/listings")).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("offers a sign-in link back to this page when the session expired (401)", async () => {
    window.history.pushState({}, "", "/post/create-listing?category=electronics");
    mockListingSubmitResponse({ status: 401, body: { error: "Unauthorized" } });

    render(<CreateListingPage />);
    await termsLoaded();
    fillAndSubmitListing();

    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute(
      "href",
      `/login?returnUrl=${encodeURIComponent("/post/create-listing?category=electronics")}`
    );
    expect(screen.getByText(/re-attach your photos and videos/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    window.history.pushState({}, "", "/");
  });

  it.each(["https://evil.example/phish", "//evil.example/phish", "javascript:alert(1)"])(
    "does not follow an unsafe server redirectUrl (%s)",
    async (redirectUrl) => {
      mockListingSubmitResponse({ status: 403, body: { redirectUrl } });

      render(<CreateListingPage />);
      await termsLoaded();
      fillAndSubmitListing();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");
      });
      expect(mockPush).not.toHaveBeenCalledWith(redirectUrl);
    }
  );

  describe("draft restore and discard", () => {
    const DRAFT_USER_ID = "user-draft-listing-123";

    function seedDraft(overrides: Record<string, unknown> = {}) {
      const data = {
        category: "electronics",
        condition: "used",
        categoryAttributes: { device_type: "Smartphone", brand: "Apple" },
        title: "Saved iPhone 15",
        description: "A draft description from last session.",
        price: "2500",
        negotiable: true,
        province: "Gauteng",
        city: "Johannesburg",
        town: "",
        address: "",
        contactMethods: ["call", "whatsapp"],
        ...overrides,
      };
      localStorage.setItem(
        `vm-draft:listing:${DRAFT_USER_ID}`,
        JSON.stringify({ v: 1, savedAt: Date.now(), step: 0, data })
      );
    }

    beforeEach(() => {
      useAuthMock.mockReturnValue({
        user: { id: DRAFT_USER_ID, email: "draft@test.com" },
        profile: null,
        isLoading: false,
      });
    });

    it("restores title and description from a saved draft and shows a toast", async () => {
      seedDraft();
      render(<CreateListingPage />);

      await waitFor(() => {
        expect(screen.getByLabelText("Title (Required)")).toHaveValue("Saved iPhone 15");
      });
      expect(screen.getByLabelText("Description (Required)")).toHaveValue(
        "A draft description from last session."
      );
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft restored" }));
    });

    it("clears restored fields when discard draft is clicked", async () => {
      seedDraft();
      render(<CreateListingPage />);

      await waitFor(() => {
        expect(screen.getByLabelText("Title (Required)")).toHaveValue("Saved iPhone 15");
      });

      fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

      expect(screen.getByLabelText("Title (Required)")).toHaveValue("");
      expect(screen.getByLabelText("Description (Required)")).toHaveValue("");
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft discarded" }));
    });

    it("post templates: ?template fills the form instead of the saved draft", async () => {
      const id = "00000000-0000-4000-8000-0000000000e1";
      const list = {
        package_running: true,
        templates: [
          {
            id,
            kind: "listing",
            name: "Used phone",
            data: {
              category: "electronics",
              categoryAttributes: { device_type: "Smartphone", brand: "Samsung" },
              description: "Template wording that every phone post repeats.",
              province: "Gauteng",
              city: "Pretoria",
              contactMethods: ["whatsapp"],
            },
            updated_at: "2026-11-21T10:00:00Z",
          },
        ],
      };
      const base = global.fetch;
      global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/api/post-templates")
          ? Promise.resolve(new Response(JSON.stringify(list), { status: 200 }))
          : base(input, init)
      ) as typeof fetch;
      switches.SHOW_POST_TEMPLATES = true;
      seedDraft();
      window.history.replaceState(null, "", `/post/create-listing?template=${id}`);
      try {
        render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByLabelText("Description (Required)")).toHaveValue(
            "Template wording that every phone post repeats."
          );
        });
        expect(screen.getByTestId("category-picker")).toHaveAttribute("data-value", "electronics");
        expect(screen.getByLabelText("Title (Required)")).toHaveValue("");
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Started from "Used phone"' })
        );
        expect(mockToast).not.toHaveBeenCalledWith(
          expect.objectContaining({ title: "Draft restored" })
        );
        expect(window.location.search).toBe("");
      } finally {
        switches.SHOW_POST_TEMPLATES = false;
        global.fetch = base;
        window.history.replaceState(null, "", "/");
      }
    });

    it("post templates: Undo puts back the draft the template replaced", async () => {
      const id = "00000000-0000-4000-8000-0000000000e1";
      const list = {
        package_running: true,
        templates: [
          {
            id,
            kind: "listing",
            name: "Used phone",
            data: {
              category: "electronics",
              description: "Template wording that every phone post repeats.",
            },
            updated_at: "2026-11-21T10:00:00Z",
          },
        ],
      };
      const base = global.fetch;
      const templateFetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(new Response(JSON.stringify(list), { status: 200 }))
      );
      global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/api/post-templates")
          ? templateFetch(input, init)
          : base(input, init)
      ) as typeof fetch;
      switches.SHOW_POST_TEMPLATES = true;
      seedDraft();
      window.history.replaceState(null, "", `/post/create-listing?template=${id}`);
      try {
        render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByLabelText("Description (Required)")).toHaveValue(
            "Template wording that every phone post repeats."
          );
        });
        // The template's read gives up after a while (then the draft opens).
        expect(templateFetch.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
        const started = mockToast.mock.calls.find(
          ([shown]) => shown.title === 'Started from "Used phone"'
        );
        expect(started?.[0].action).toBeTruthy();
        act(() => started?.[0].action.props.onClick());
        await waitFor(() => {
          expect(screen.getByLabelText("Title (Required)")).toHaveValue("Saved iPhone 15");
        });
        expect(screen.getByLabelText("Description (Required)")).toHaveValue(
          "A draft description from last session."
        );
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Draft restored" })
        );
        // And in storage: the autosave keeps the draft again.
        await waitFor(
          () =>
            expect(localStorage.getItem(`vm-draft:listing:${DRAFT_USER_ID}`)).toContain(
              "Saved iPhone 15"
            ),
          { timeout: 3000 }
        );
      } finally {
        switches.SHOW_POST_TEMPLATES = false;
        global.fetch = base;
        window.history.replaceState(null, "", "/");
      }
    });

    /** Serves one template at /api/post-templates; returns a restore function. */
    function serveTemplate(data: Record<string, unknown>) {
      const base = global.fetch;
      global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/api/post-templates")
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  package_running: true,
                  templates: [
                    {
                      id: TEMPLATE_ID,
                      kind: "listing",
                      name: "Used phone",
                      data,
                      updated_at: "2026-11-21T10:00:00Z",
                    },
                  ],
                }),
                { status: 200 }
              )
            )
          : base(input, init)
      ) as typeof fetch;
      switches.SHOW_POST_TEMPLATES = true;
      return () => {
        switches.SHOW_POST_TEMPLATES = false;
        global.fetch = base;
        window.history.replaceState(null, "", "/");
      };
    }
    const TEMPLATE_ID = "00000000-0000-4000-8000-0000000000e1";
    const PHONE = { category: "electronics", description: "Template wording for phones." };
    const draftKey = `vm-draft:listing:${DRAFT_USER_ID}`;

    it("post templates: until the first edit the old draft stays saved and Undo stays offered", async () => {
      const dismiss = vi.fn();
      mockToast.mockReturnValue({ id: "toast", dismiss, update: vi.fn() });
      const restore = serveTemplate(PHONE);
      seedDraft();
      window.history.replaceState(null, "", `/post/create-listing?template=${TEMPLATE_ID}`);
      try {
        render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByLabelText("Description (Required)")).toHaveValue(
            "Template wording for phones."
          );
        });
        // The message stays until Undo or the first edit.
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Started from "Used phone"', duration: Infinity })
        );
        // A reload in this window would restore the old draft: nothing is saved over it.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        expect(localStorage.getItem(draftKey)).toContain("Saved iPhone 15");
        expect(dismiss).not.toHaveBeenCalled();
        // The first edit ends the offer and is saved.
        fireEvent.change(screen.getByLabelText("Title (Required)"), {
          target: { value: "Samsung A15 128GB" },
        });
        await waitFor(() => expect(dismiss).toHaveBeenCalled());
        await waitFor(() => expect(localStorage.getItem(draftKey)).toContain("Samsung A15 128GB"), {
          timeout: 3000,
        });
      } finally {
        restore();
      }
    });

    it("post templates: a category change through the form ends the Undo offer", async () => {
      const dismiss = vi.fn();
      mockToast.mockReturnValue({ id: "toast", dismiss, update: vi.fn() });
      const restore = serveTemplate({ ...PHONE, category: "vehicles" });
      seedDraft();
      window.history.replaceState(null, "", `/post/create-listing?template=${TEMPLATE_ID}`);
      try {
        render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByTestId("category-picker")).toHaveAttribute("data-value", "vehicles");
        });
        expect(dismiss).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Select Electronics" }));
        await waitFor(() => expect(dismiss).toHaveBeenCalled());
      } finally {
        restore();
      }
    });

    it("post templates: a kept form opened again with a template sets aside the work in it", async () => {
      const restore = serveTemplate(PHONE);
      window.history.replaceState(null, "", "/post/create-listing");
      try {
        const view = render(<CreateListingPage />);
        await waitFor(() => expect(screen.getByLabelText("Title (Required)")).toHaveValue(""));
        fireEvent.change(screen.getByLabelText("Title (Required)"), {
          target: { value: "My hatchback" },
        });
        // Create Post, then Use: the same page instance, now with a template.
        window.history.replaceState(null, "", `/post/create-listing?template=${TEMPLATE_ID}`);
        view.rerender(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByLabelText("Description (Required)")).toHaveValue(
            "Template wording for phones."
          );
        });
        expect(screen.getByLabelText("Title (Required)")).toHaveValue("");
        const started = mockToast.mock.calls.find(
          ([shown]) => shown.title === 'Started from "Used phone"'
        );
        act(() => started?.[0].action.props.onClick());
        await waitFor(() => {
          expect(screen.getByLabelText("Title (Required)")).toHaveValue("My hatchback");
        });
      } finally {
        restore();
      }
    });

    it("post templates: the member's area fills in with the template, not as a later edit", async () => {
      const dismiss = vi.fn();
      mockToast.mockReturnValue({ id: "toast", dismiss, update: vi.fn() });
      useAuthMock.mockReturnValue({
        user: { id: DRAFT_USER_ID, email: "draft@test.com" },
        profile: { location_province: "Gauteng", location_city: "Pretoria" },
        isLoading: false,
      });
      const restore = serveTemplate(PHONE);
      seedDraft();
      window.history.replaceState(null, "", `/post/create-listing?template=${TEMPLATE_ID}`);
      try {
        render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByLabelText("Description (Required)")).toHaveValue(
            "Template wording for phones."
          );
        });
        await new Promise((resolve) => setTimeout(resolve, 1200));
        expect(dismiss).not.toHaveBeenCalled();
        expect(localStorage.getItem(draftKey)).toContain("Saved iPhone 15");
      } finally {
        restore();
      }
    });

    it("post templates: a template that changes nothing still saves the first edit", async () => {
      const dismiss = vi.fn();
      mockToast.mockReturnValue({ id: "toast", dismiss, update: vi.fn() });
      const restore = serveTemplate(PHONE);
      window.history.replaceState(null, "", `/post/create-listing?template=${TEMPLATE_ID}`);
      try {
        const view = render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByLabelText("Description (Required)")).toHaveValue(
            "Template wording for phones."
          );
        });
        // The same template again leaves the form exactly as it is.
        window.history.replaceState(null, "", `/post/create-listing?template=${TEMPLATE_ID}`);
        view.rerender(<CreateListingPage />);
        await waitFor(() => expect(window.location.search).toBe(""));
        await waitFor(() =>
          expect(
            mockToast.mock.calls.filter(([s]) => s.title === 'Started from "Used phone"')
          ).toHaveLength(2)
        );
        fireEvent.change(screen.getByLabelText("Title (Required)"), {
          target: { value: "Galaxy A15" },
        });
        await waitFor(() => expect(localStorage.getItem(draftKey)).toContain("Galaxy A15"), {
          timeout: 3000,
        });
      } finally {
        restore();
      }
    });

    it("post templates: leaving the form closes the Undo message", async () => {
      const dismiss = vi.fn();
      mockToast.mockReturnValue({ id: "toast", dismiss, update: vi.fn() });
      const restore = serveTemplate(PHONE);
      seedDraft();
      window.history.replaceState(null, "", `/post/create-listing?template=${TEMPLATE_ID}`);
      try {
        const view = render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByLabelText("Description (Required)")).toHaveValue(
            "Template wording for phones."
          );
        });
        expect(dismiss).not.toHaveBeenCalled();
        view.unmount();
        expect(dismiss).toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it("post templates: Undo brings back the draft as stored now", async () => {
      const restore = serveTemplate(PHONE);
      seedDraft();
      window.history.replaceState(null, "", `/post/create-listing?template=${TEMPLATE_ID}`);
      try {
        render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByLabelText("Description (Required)")).toHaveValue(
            "Template wording for phones."
          );
        });
        // Another tab saves newer work meanwhile.
        seedDraft({ title: "Newer from another tab" });
        const started = mockToast.mock.calls.find(
          ([shown]) => shown.title === 'Started from "Used phone"'
        );
        act(() => started?.[0].action.props.onClick());
        await waitFor(() => {
          expect(screen.getByLabelText("Title (Required)")).toHaveValue("Newer from another tab");
        });
      } finally {
        restore();
      }
    });

    it("post templates: a template that fails to load restores the saved draft", async () => {
      const base = global.fetch;
      global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/api/post-templates")
          ? Promise.resolve(new Response("{}", { status: 503 }))
          : base(input, init)
      ) as typeof fetch;
      switches.SHOW_POST_TEMPLATES = true;
      seedDraft();
      window.history.replaceState(
        null,
        "",
        "/post/create-listing?template=00000000-0000-4000-8000-0000000000e1"
      );
      try {
        render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByLabelText("Title (Required)")).toHaveValue("Saved iPhone 15");
        });
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "This template can't be opened" })
        );
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Draft restored" })
        );
      } finally {
        switches.SHOW_POST_TEMPLATES = false;
        global.fetch = base;
        window.history.replaceState(null, "", "/");
      }
    });

    it("still validates missing category after restoring a draft", async () => {
      seedDraft({ category: "" });
      render(<CreateListingPage />);

      await waitFor(() => {
        expect(screen.getByLabelText("Title (Required)")).toHaveValue("Saved iPhone 15");
      });

      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      expect(screen.getAllByText("Select a category.").length).toBeGreaterThan(0);
    });
  });

  describe("copy a post (?copy=)", () => {
    const copyId = "33333333-3333-4333-8333-333333333333";
    const photo = "https://media.verifymzansi.com/media/11111111-1111-4111-8111-111111111111";
    const draft = (category: string, attributes: Record<string, unknown>) => ({
      id: copyId,
      owner_id: "owner-1",
      status: "draft",
      revision: 1,
      title: "Used iPhone 15",
      description: "A clean listing description with enough detail to continue.",
      price_cents: 150000,
      price_negotiable: false,
      category,
      attributes,
      location_province: "Gauteng",
      location_city: "Johannesburg",
      contact_methods: ["call"],
      photos: [photo],
      videos: [],
      logo_url: null,
      focal_x: 0.5,
      focal_y: 0.5,
    });
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    /** The copy's read, its save (revision 2, then 3) and the submissions in turn. */
    function serveCopy(listing: Record<string, unknown>, submissions: unknown[] = []) {
      let saves = 0;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === `/api/listings/${copyId}` && (init?.method ?? "GET") === "GET")
          return ok({ listing });
        if (input === `/api/listings/${copyId}`)
          return ok({ success: true, status: "draft", revision: 2 + saves++ });
        if (input === "/api/content/resubmit")
          return (
            submissions.shift() ?? ok({ id: copyId, status: "pending_moderation", success: true })
          );
        return ok({ success: true });
      });
    }
    /** The member's terms: accepted (or not yet); an acceptance answers accepted. */
    function serveTerms(acceptedAt: string | null) {
      postingTermsFetch.mockImplementation(async (_input: unknown, init?: RequestInit) =>
        ok({
          ...SERVED_POSTING_TERMS,
          accepted_at: init?.method === "POST" ? "2026-11-21T10:00:00.000Z" : acceptedAt,
        })
      );
    }
    async function termsReady() {
      await waitFor(() => expect(postingTermsFetch).toHaveBeenCalled());
      await act(async () => {});
    }
    const saves = () =>
      fetchMock.mock.calls
        .filter((call) => call[0] === `/api/listings/${copyId}` && call[1]?.method === "PUT")
        .map((call) => JSON.parse(call[1].body as string));
    beforeEach(() => {
      switches.SHOW_POST_COPY = true;
      useAuthMock.mockReturnValue({ user: { id: "owner-1" }, profile: null, isLoading: false });
      vi.mocked(useSearchParams).mockReturnValue(
        new URLSearchParams(`copy=${copyId}`) as unknown as ReturnType<typeof useSearchParams>
      );
      serveTerms("2026-11-01T10:00:00.000Z");
    });
    afterEach(() => {
      switches.SHOW_POST_COPY = false;
      vi.mocked(useSearchParams).mockImplementation(
        () =>
          new URLSearchParams(window.location.search) as unknown as ReturnType<
            typeof useSearchParams
          >
      );
      useAuthMock.mockReturnValue({ user: null, profile: null, isLoading: false });
    });

    it("opens the copy on the last step with the note, and submits it for review", async () => {
      serveCopy(draft("electronics", { device_type: "Smartphone", brand: "Apple" }));
      render(<CreateListingPage />);
      expect(await screen.findByText(/Copy of .Used iPhone 15/)).toBeInTheDocument();
      expect(screen.getByText(/Video not copied/)).toBeInTheDocument();
      expect(screen.getByText(/Same title as the post you copied/)).toBeInTheDocument();
      await termsReady();
      // The terms were accepted with the first post: no tick on a copy.
      expect(screen.queryByLabelText(/I accept the VerifyMzansi posting terms/i)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/listings"));
      const [payload] = saves();
      expect(payload.images).toEqual([photo]);
      expect(payload.videos).toEqual([]);
      expect(payload.expectedRevision).toBe(1);
      const submit = fetchMock.mock.calls.find((call) => call[0] === "/api/content/resubmit");
      expect(JSON.parse(submit![1].body as string)).toMatchObject({
        itemId: copyId,
        expectedRevision: 2,
        contentType: "listing",
      });
      expect(fetchMock.mock.calls.some((call) => call[0] === "/api/listings")).toBe(false);
      expect(postingTermsFetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
      // The form's own autosaved draft is never touched by a copy.
      expect(localStorage.length).toBe(0);
    });

    it("asks for the current terms on a copy when they are not accepted yet", async () => {
      serveTerms(null);
      serveCopy(draft("electronics", { device_type: "Smartphone", brand: "Apple" }));
      render(<CreateListingPage />);
      expect(await screen.findByText(/Copy of/)).toBeInTheDocument();
      await termsReady();

      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
      expect(
        (await screen.findAllByText("Accept the posting terms before submitting.")).length
      ).toBeGreaterThan(0);
      expect(saves()).toHaveLength(0);

      fireEvent.click(screen.getByLabelText(/I accept the VerifyMzansi posting terms/i));
      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/listings"));
      const acceptance = postingTermsFetch.mock.calls.find((call) => call[1]?.method === "POST");
      expect(JSON.parse(acceptance![1].body as string)).toEqual({
        version: SERVED_POSTING_TERMS.version,
        document_hash: SERVED_POSTING_TERMS.document_hash,
        accepted: true,
      });
      expect(saves()).toHaveLength(1);
    });

    it("a refused submission can be sent again: a new request at the saved version", async () => {
      const photoRefusal = {
        ok: false,
        status: 422,
        json: async () => ({
          error: "Add at least one new photo of this item. Each car or home is a different item.",
          reason: "copy_new_photo_required",
        }),
      };
      serveCopy(
        draft("vehicles", {
          make: "Toyota",
          model: "Hilux",
          year: "2019",
          mileage_km: "98000",
          transmission: "manual",
          fuel_type: "diesel",
          service_history: "full",
          condition: "used",
        }),
        [photoRefusal]
      );
      render(<CreateListingPage />);
      expect(await screen.findByText(/Copy of/)).toBeInTheDocument();
      await termsReady();

      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
      expect(
        (await screen.findAllByText(/Add at least one new photo of this item/)).length
      ).toBeGreaterThan(0);

      // The member adds a photo (not uploaded in this test) and sends it again.
      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/listings"));
      const [first, second] = saves();
      expect(first.expectedRevision).toBe(1);
      expect(second.expectedRevision).toBe(2);
      expect(second.postRequestId).not.toBe(first.postRequestId);
    });

    it("ignores ?copy= while the switch is off", async () => {
      switches.SHOW_POST_COPY = false;
      serveCopy(draft("electronics", {}));
      render(<CreateListingPage />);
      await termsReady();
      expect(screen.queryByText(/Copy of/)).toBeNull();
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).startsWith("/api/listings/"))
      ).toBe(false);
    });

    it("goes back to My posts when the copy is no longer a draft", async () => {
      serveCopy({ ...draft("electronics", {}), status: "pending_moderation" });
      render(<CreateListingPage />);
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/listings"));
    });
  });
});
