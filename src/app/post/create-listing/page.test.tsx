import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateListingPage from "./page";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

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
  useSearchParams: vi.fn().mockReturnValue(new URLSearchParams()),
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
    onChange,
    onAttributeChange,
  }: {
    onChange: (value: string) => void;
    onAttributeChange: (name: string, value: string | boolean) => void;
  }) => (
    <div data-testid="category-picker">
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

vi.mock("@/lib/utils/format", () => ({
  formatZAR: (cents: number) => `R ${(cents / 100).toFixed(2)}`,
}));

describe("CreateListingPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    global.URL.createObjectURL = vi.fn(() => "blob:logo-preview");
    global.URL.revokeObjectURL = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as unknown as typeof fetch;
  });

  function acceptListingTerms() {
    fireEvent.click(screen.getByLabelText(/I accept the VerifyMzansi posting terms/i));
  }

  it("renders the shared guide and step labels", () => {
    render(<CreateListingPage />);

    const stepNav = screen.getByRole("navigation", { name: "Mzansi Market creation steps" });

    expect(screen.getByText("Quick guide")).toBeInTheDocument();
    expect(within(stepNav).getAllByText("Details").length).toBeGreaterThan(0);
    expect(within(stepNav).getAllByText("Price & Location").length).toBeGreaterThan(0);
    expect(within(stepNav).getAllByText("Media").length).toBeGreaterThan(0);
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
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Used iPhone 15" } });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/(Asking Price|Monthly Rent) \(ZAR\) \*/), {
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
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Used iPhone 15" } });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/(Asking Price|Monthly Rent) \(ZAR\) \*/), {
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
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/media/upload") {
          const callIndex = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
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
      }
    );

    render(<CreateListingPage />);

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Used iPhone 15" } });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/(Asking Price|Monthly Rent) \(ZAR\) \*/), {
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
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((call) => call[0] === "/api/listings")).toBe(true);
    });

    const request = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "/api/listings"
    );
    expect(request).toBeDefined();
    if (!request) {
      throw new Error("Expected /api/listings submission call");
    }
    const payload = JSON.parse(request[1].body as string);

    expect(payload.logo_url).toBe("https://media.verifymzansi.com/listings/logo.jpg");
    expect(payload.images).toEqual(["https://media.verifymzansi.com/listings/photo.jpg"]);
    expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");
  });

  it("maps API 422 photo-limit errors to listing media field errors", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
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
      }
    );

    render(<CreateListingPage />);

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Used iPhone 15" } });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/(Asking Price|Monthly Rent) \(ZAR\) \*/), {
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
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
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
      }
    );

    render(<CreateListingPage />);

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Used iPhone 15" } });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/(Asking Price|Monthly Rent) \(ZAR\) \*/), {
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

  it("uploads listing videos through the shared direct path with validated fallback", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/media/upload-url") {
          return {
            ok: false,
            status: 410,
            json: async () => ({ code: "direct_media_uploads_disabled" }),
          };
        }

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
      }
    );

    render(<CreateListingPage />);

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Used iPhone 15" } });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/(Asking Price|Monthly Rent) \(ZAR\) \*/), {
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
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((call) => call[0] === "/api/listings")).toBe(true);
    });

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((call) => call[0] === "/api/media/upload-url")).toBe(true);
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
  });

  it("keeps users on the media step with a videos field error when listing video upload fails", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/media/upload-url") {
          return {
            ok: false,
            status: 410,
            json: async () => ({ code: "direct_media_uploads_disabled" }),
          };
        }

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
      }
    );

    render(<CreateListingPage />);

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Used iPhone 15" } });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/(Asking Price|Monthly Rent) \(ZAR\) \*/), {
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
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
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
      }
    );

    render(<CreateListingPage />);

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Used iPhone 15" } });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/(Asking Price|Monthly Rent) \(ZAR\) \*/), {
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
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
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
      }
    );

    render(<CreateListingPage />);

    fireEvent.click(screen.getByText("Select Electronics"));
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Used iPhone 15" } });
    fireEvent.change(screen.getByLabelText("Description *"), {
      target: { value: "A clean listing description with enough detail to continue." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText(/(Asking Price|Monthly Rent) \(ZAR\) \*/), {
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
        expect(screen.getByLabelText("Title *")).toHaveValue("Saved iPhone 15");
      });
      expect(screen.getByLabelText("Description *")).toHaveValue(
        "A draft description from last session."
      );
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft restored" }));
    });

    it("clears restored fields when discard draft is clicked", async () => {
      seedDraft();
      render(<CreateListingPage />);

      await waitFor(() => {
        expect(screen.getByLabelText("Title *")).toHaveValue("Saved iPhone 15");
      });

      fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

      expect(screen.getByLabelText("Title *")).toHaveValue("");
      expect(screen.getByLabelText("Description *")).toHaveValue("");
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft discarded" }));
    });

    it("still validates missing category after restoring a draft", async () => {
      seedDraft({ category: "" });
      render(<CreateListingPage />);

      await waitFor(() => {
        expect(screen.getByLabelText("Title *")).toHaveValue("Saved iPhone 15");
      });

      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      expect(screen.getAllByText("Select a category.").length).toBeGreaterThan(0);
    });
  });
});
