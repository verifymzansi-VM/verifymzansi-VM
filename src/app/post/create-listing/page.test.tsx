import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateListingPage from "./page";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

const { listingCardSpy } = vi.hoisted(() => ({
  listingCardSpy: vi.fn(),
}));

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
  MediaUpload: ({ label, onChange }: { label: string; onChange?: (files: File[]) => void }) => (
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
  ),
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
    global.URL.createObjectURL = vi.fn(() => "blob:logo-preview");
    global.URL.revokeObjectURL = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as unknown as typeof fetch;
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

    fireEvent.change(screen.getByLabelText("Price (ZAR) *"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Johannesburg" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(screen.getByRole("button", { name: "Listing logo (optional)" }));
    fireEvent.click(screen.getByRole("button", { name: "Photos (max 5)" }));

    expect(listingCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "blob:logo-preview",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    const request = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[2];
    const payload = JSON.parse(request[1].body as string);

    expect(payload.logo_url).toBe("https://media.verifymzansi.com/listings/logo.jpg");
    expect(payload.images).toEqual(["https://media.verifymzansi.com/listings/photo.jpg"]);
    expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");
  });
});
