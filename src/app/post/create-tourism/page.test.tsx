import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateTourismPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn().mockReturnValue(null) }),
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

vi.mock("@/components/billing/plan-gate", () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePlanMaxPhotos: () => 10,
  usePlanMaxVideos: () => 3,
  usePlanVideoAllowed: () => true,
  usePlanCoverVideoAllowed: () => true,
}));

vi.mock("@/components/post/post-form-scaffold", () => ({
  PostFormScaffold: ({
    children,
    footer,
  }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
  PostFormFooter: () => null,
}));

vi.mock("@/components/ui/location-selector", () => ({
  LocationSelector: () => <div>Location Selector</div>,
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: () => <div>Media Upload</div>,
}));

vi.mock("@/components/ui/video-frame-selector", () => ({
  VideoFrameSelector: () => <div>Video Frame Selector</div>,
}));

vi.mock("@/components/ui/media-crop-preview", () => ({
  MediaCropPreview: () => <div>Media Crop Preview</div>,
}));

vi.mock("@/components/promotions/social-authorization-fields", () => ({
  SocialAuthorizationFields: () => <div>Social Authorization</div>,
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

describe("CreateTourismPage type switch behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
