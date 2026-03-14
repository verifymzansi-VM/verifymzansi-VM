import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateListingPage from "./page";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn().mockReturnValue("/post/create-listing"),
  useSearchParams: vi.fn().mockReturnValue(new URLSearchParams()),
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

vi.mock("@/components/billing/plan-gate", () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePlanMaxPhotos: () => 5,
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
  MediaUpload: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) =>
    province === "Gauteng" ? ["Johannesburg", "Pretoria"] : [],
}));

vi.mock("@/lib/utils/format", () => ({
  formatZAR: (cents: number) => `R ${(cents / 100).toFixed(2)}`,
}));

describe("CreateListingPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
  });

  it("renders the shared guide and step labels", () => {
    render(<CreateListingPage />);

    expect(screen.getByText("Quick guide")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Pricing & Reach")).toBeInTheDocument();
    expect(screen.getByText("Media & Review")).toBeInTheDocument();
  });

  it("shows inline validation instead of only using toast errors", () => {
    render(<CreateListingPage />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Select a category.")).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText("Price (ZAR) *"), { target: { value: "1500" } });
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

    fireEvent.change(screen.getByLabelText("Price (ZAR) *"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText(/Listing preview/i)).toBeInTheDocument();
    expect(screen.getByText("Brand")).toBeInTheDocument();
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText(/Electronics/i)).toBeInTheDocument();
  });
});
