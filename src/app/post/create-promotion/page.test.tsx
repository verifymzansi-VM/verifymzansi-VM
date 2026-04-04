import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreatePromotionPage from "./page";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

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
  }),
}));

describe("CreatePromotionPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new URLSearchParams());
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ businesses: [] }),
    }) as unknown as typeof fetch;
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

    expect(screen.getByText("Select a province.")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Saved contact methods")).toBeInTheDocument();
    expect(screen.getByText("Phone Call")).toBeInTheDocument();
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
        socialAuthorization: { granted: false },
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

      fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));

      expect(screen.getByLabelText(/Title/i)).toHaveValue("");
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Draft discarded" }));
    });
  });
});
