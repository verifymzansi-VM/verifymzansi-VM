import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreatePromotionPage from "./page";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";

type MockAuthState = {
  user: { id: string; email?: string | null } | null;
  profile: Record<string, unknown> | null;
  isLoading: boolean;
};

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn<() => MockAuthState>(() => ({ user: null, profile: null, isLoading: false })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn().mockReturnValue("/post/create-promotion"),
  useSearchParams: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: useAuthMock,
}));

vi.mock("@/lib/utils/fetch-retry", () => ({
  fetchWithRetry: vi.fn(),
}));

vi.mock("@/lib/utils/upload-preflight", () => ({
  checkUploadServiceReachable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/media/compress-before-upload", () => ({
  compressVideoForUpload: vi.fn(async (file: File) => file),
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

vi.mock("@/components/billing/plan-gate", () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePlanMaxPhotos: () => 5,
  usePlanMaxVideos: () => 1,
  usePlanVideoAllowed: () => true,
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({ label, onChange }: { label: string; onChange: (files: File[]) => void }) => (
    <div>
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange([new File(["demo"], "clip.mp4", { type: "video/mp4" })])}
      >
        Add media for {label}
      </button>
    </div>
  ),
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) =>
    province === "Gauteng" ? ["Johannesburg", "Pretoria"] : [],
  getTownsForCity: () => [],
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

describe("CreatePromotionPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as unknown as ReturnType<
      typeof useRouter
    >);
    vi.mocked(useToast).mockReturnValue({
      toast: mockToast,
      dismiss: vi.fn(),
      toasts: [],
    });
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>
    );
    vi.mocked(fetchWithRetry).mockImplementation((input: RequestInfo | URL) => fetch(input));
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ businesses: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function completeStepOne() {
    fireEvent.change(screen.getByLabelText(/Title/i), {
      target: { value: "Weekend Fresh Produce Sale" },
    });
    fireEvent.change(screen.getByLabelText(/Event Details|Description/i), {
      target: {
        value: "A detailed promotion description that is long enough for the validation rules.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  it("renders the Tourism & Events area label", async () => {
    render(<CreatePromotionPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(screen.getAllByText("Tourism & Events").length).toBeGreaterThan(0);
  });

  it("does not render a promotion type selector (events only)", async () => {
    render(<CreatePromotionPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(screen.queryByLabelText("Promotion Type")).not.toBeInTheDocument();
  });

  it("shows event guide text by default", async () => {
    render(<CreatePromotionPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(
      screen.getAllByText(
        "Add the event details, tell people where it happens, and submit it for review."
      ).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows inline validation on the location step", async () => {
    render(<CreatePromotionPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    completeStepOne();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getAllByText("Select a province.").length).toBeGreaterThan(0);
  });

  it("shows the optional video thumbnail field only after video upload", async () => {
    render(<CreatePromotionPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    completeStepOne();
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.queryByText("Video thumbnail (optional)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add media for Videos/i }));
    expect(screen.getByText("Video thumbnail (optional)")).toBeInTheDocument();
  });

  it("renders event state and readable contact methods in the preview step", async () => {
    render(<CreatePromotionPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    completeStepOne();

    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.change(screen.getByLabelText(/Start Date$/i), {
      target: { value: "2099-03-10" },
    });
    fireEvent.change(screen.getByLabelText(/End Date$/i), {
      target: { value: "2099-03-12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Upcoming Event")).toBeInTheDocument();
    expect(document.querySelector('[data-layout-mode="review"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Saved contact methods")).toBeInTheDocument();
    expect(screen.getByText("Phone Call")).toBeInTheDocument();
  });

  it("maps API 422 photo-limit errors to the photos field on submit", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/csrf") {
        return {
          ok: true,
          json: async () => ({ token: "a".repeat(64) }),
        };
      }

      if (input === "/api/businesses?mine=true&limit=50") {
        return {
          ok: true,
          json: async () => ({ businesses: [] }),
        };
      }

      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({ urls: ["https://media.verifymzansi.com/promotions/photo.jpg"] }),
        };
      }

      if (input === "/api/promotions") {
        return {
          ok: false,
          status: 422,
          json: async () => ({ error: "Maximum 5 photos allowed on your plan" }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(<CreatePromotionPage />);

    completeStepOne();
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Photos/i }));
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(screen.getAllByText("Maximum 5 photos allowed on your plan").length).toBeGreaterThan(
        0
      );
      expect(screen.getByText(/Please fix 1 field on Step 3/i)).toBeInTheDocument();
    });
  });

  it("maps API 422 video-limit errors to the videos field on submit", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/csrf") {
        return {
          ok: true,
          json: async () => ({ token: "a".repeat(64) }),
        };
      }

      if (input === "/api/businesses?mine=true&limit=50") {
        return {
          ok: true,
          json: async () => ({ businesses: [] }),
        };
      }

      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({ urls: ["https://media.verifymzansi.com/promotions/photo.jpg"] }),
        };
      }

      if (input === "/api/promotions") {
        return {
          ok: false,
          status: 422,
          json: async () => ({ error: "Video upload is not available on your current plan." }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(<CreatePromotionPage />);

    completeStepOne();
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Photos/i }));
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(
        screen.getAllByText("Video upload is not available on your current plan.").length
      ).toBeGreaterThan(0);
      expect(screen.getByText(/Please fix 1 field on Step 3/i)).toBeInTheDocument();
    });
  });

  it("blocks submit when photo upload returns partial success", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/csrf") {
        return {
          ok: true,
          json: async () => ({ token: "a".repeat(64) }),
        };
      }

      if (input === "/api/businesses?mine=true&limit=50") {
        return {
          ok: true,
          json: async () => ({ businesses: [] }),
        };
      }

      if (input === "/api/media/upload") {
        return {
          ok: true,
          status: 207,
          json: async () => ({
            urls: ["https://media.verifymzansi.com/promotions/photo.jpg"],
            errors: ['"photo-2.jpg": upload failed'],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(<CreatePromotionPage />);

    completeStepOne();
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Photos/i }));
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

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("allows video-only submit", async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/media/upload-url") {
        return {
          ok: true,
          json: async () => ({
            uploadUrl: "https://upload.example.com/promo-video",
            publicUrl: "https://media.verifymzansi.com/promotions/video.mp4",
          }),
        } as Response;
      }

      if (input === "https://upload.example.com/promo-video") {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }

      return fetch(input);
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/csrf") {
        return {
          ok: true,
          json: async () => ({ token: "a".repeat(64) }),
        };
      }

      if (input === "/api/businesses?mine=true&limit=50") {
        return {
          ok: true,
          json: async () => ({ businesses: [] }),
        };
      }

      if (input === "/api/promotions") {
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, promotion: { id: "promo-1" } }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(<CreatePromotionPage />);

    completeStepOne();
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Videos/i }));
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/promotions",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(
            '"videos":["https://media.verifymzansi.com/promotions/video.mp4"]'
          ),
        })
      );
    });
  });

  it("redirects to complete profile when API returns phone-gate 403 redirectUrl", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/csrf") {
        return {
          ok: true,
          json: async () => ({ token: "a".repeat(64) }),
        };
      }

      if (input === "/api/businesses?mine=true&limit=50") {
        return {
          ok: true,
          json: async () => ({ businesses: [] }),
        };
      }

      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({ urls: ["https://media.verifymzansi.com/promotions/photo.jpg"] }),
        };
      }

      if (input === "/api/promotions") {
        return {
          ok: false,
          status: 403,
          json: async () => ({ redirectUrl: "/dashboard/complete-profile" }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(<CreatePromotionPage />);

    completeStepOne();
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Photos/i }));
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/complete-profile");
    });
  });

  it("shows plan-limit reason when API returns 403 reason", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/csrf") {
        return {
          ok: true,
          json: async () => ({ token: "a".repeat(64) }),
        };
      }

      if (input === "/api/businesses?mine=true&limit=50") {
        return {
          ok: true,
          json: async () => ({ businesses: [] }),
        };
      }

      if (input === "/api/media/upload") {
        return {
          ok: true,
          json: async () => ({ urls: ["https://media.verifymzansi.com/promotions/photo.jpg"] }),
        };
      }

      if (input === "/api/promotions") {
        return {
          ok: false,
          status: 403,
          json: async () => ({ reason: "You reached your plan posting limit." }),
        };
      }

      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(<CreatePromotionPage />);

    completeStepOne();
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: /Add media for Photos/i }));
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    await waitFor(() => {
      expect(screen.getByText("You reached your plan posting limit.")).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  describe("draft restore", () => {
    const DRAFT_USER_ID = "user-draft-promo-123";

    function seedDraft(overrides: Record<string, unknown> = {}) {
      const data = {
        promotionType: "event",
        title: "Saved Music Festival",
        description: "A draft promotion description that is long enough to pass validation.",
        category: "",
        categoryKey: "",
        priceZar: "",
        negotiable: false,
        province: "Gauteng",
        city: "Johannesburg",
        locationTown: "",
        locationAddress: "",
        contactMethods: ["call"],
        startDate: "2099-06-01",
        endDate: "2099-06-08",
        businessId: "",
        ...overrides,
      };
      localStorage.setItem(
        `vm-draft:promotion:${DRAFT_USER_ID}`,
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

    it("restores title from a saved draft", async () => {
      seedDraft();
      render(<CreatePromotionPage />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());

      await waitFor(() => {
        expect(screen.getByLabelText(/Title/i)).toHaveValue("Saved Music Festival");
      });
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft restored" }));
    });

    it("clears restored fields when discard draft is clicked", async () => {
      seedDraft();
      render(<CreatePromotionPage />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());

      await waitFor(() => {
        expect(screen.getByLabelText(/Title/i)).toHaveValue("Saved Music Festival");
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
      });

      await waitFor(() => {
        expect(screen.getByLabelText(/Title/i)).toHaveValue("");
      });
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft discarded" }));
    });
  });
});
