import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreatePromotionPage from "./page";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn().mockReturnValue("/post/create-promotion"),
  useSearchParams: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
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
}));

describe("CreatePromotionPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("renders the Promotions & Events area label", async () => {
    render(<CreatePromotionPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(screen.getAllByText("Promotions & Events").length).toBeGreaterThan(0);
  });

  it("shows the four visible promotion categories", async () => {
    render(<CreatePromotionPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const typeSelect = screen.getByLabelText("Promotion Type");

    expect(screen.getByRole("option", { name: "Deals" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Promotions" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ads" })).toBeInTheDocument();
    expect(typeSelect).toHaveValue("ad");
  });

  it("switches the guide text when the type is event", async () => {
    render(<CreatePromotionPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Promotion Type"), { target: { value: "event" } });

    expect(
      screen.getByText(
        "Add the event details, tell people where it happens, and submit it for review."
      )
    ).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText(/City \/ Town/i), {
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

    fireEvent.change(screen.getByLabelText("Promotion Type"), { target: { value: "event" } });
    completeStepOne();

    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/City \/ Town/i), {
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
    expect(screen.getByText("Saved contact methods")).toBeInTheDocument();
    expect(screen.getByText("Phone Call")).toBeInTheDocument();
  });
});
