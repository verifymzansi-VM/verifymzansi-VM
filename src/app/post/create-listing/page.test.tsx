import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CreateListingPage from "./page";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

// Mock next/navigation (including usePathname for Header)
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn().mockReturnValue("/post/create-listing"),
  useSearchParams: vi.fn().mockReturnValue(new URLSearchParams()),
}));

// Mock toast hook
vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

// Mock next/link
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

// Mock Supabase client
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "test-user-id" } } }),
    },
    from: (table: string) => {
      if (table === "listings") {
        return { insert: mockInsert.mockResolvedValue({ error: null }) };
      }
      if (table === "seller_profiles") {
        return {
          select: mockSelect.mockReturnValue({
            eq: mockEq.mockReturnValue({
              single: mockSingle.mockResolvedValue({ data: { id: "test-profile-id" } }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

// Mock PlanGate and specific hooks
vi.mock("@/components/billing/plan-gate", () => ({
  PlanGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePlanMaxPhotos: () => 5,
  usePlanVideoAllowed: () => true,
}));

// Mock Header/Footer/PageHeader
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

// Mock CategoryPicker
vi.mock("@/components/listings/category-picker", () => ({
  CategoryPicker: ({ onChange }: { onChange: (value: string) => void }) => (
    <div data-testid="category-picker">
      <button type="button" onClick={() => onChange("ELECTRONICS")}>
        Select Electronics
      </button>
    </div>
  ),
}));

// Mock MediaUpload
vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <div data-testid="media-upload">
      <span>{label}</span>
      {disabled && <span>disabled</span>}
    </div>
  ),
}));

// Mock Constants
vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) => {
    if (province === "Gauteng") return ["Johannesburg", "Pretoria"];
    return [];
  },
}));

// Mock formatZAR
vi.mock("@/lib/utils/format", () => ({
  formatZAR: (cents: number) => `R ${(cents / 100).toFixed(2)}`,
  formatRelativeTime: (_d: string) => "just now",
}));

// Mock cn utility
vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// Mock fetch for media upload
global.fetch = vi.fn() as unknown as typeof fetch;

describe("CreateListingPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ urls: ["https://example.com/media.jpg"] }),
    });
  });

  it("renders the step progress indicator on first step", () => {
    render(<CreateListingPage />);
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
  });

  it("shows character counters for title and description", () => {
    render(<CreateListingPage />);
    expect(screen.getByText("0/100")).toBeInTheDocument();
    expect(screen.getByText("0/2000")).toBeInTheDocument();
  });

  it("validates step 0 before advancing — missing category", () => {
    render(<CreateListingPage />);
    const nextBtn = screen.getByRole("button", { name: /Next/i });
    fireEvent.click(nextBtn);

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Please select a category", variant: "destructive" })
    );
  });

  it("renders the Mzansi Market badge", () => {
    render(<CreateListingPage />);
    expect(screen.getByText("Mzansi Market")).toBeInTheDocument();
  });

  it("shows all three step labels", () => {
    render(<CreateListingPage />);
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Pricing & Location")).toBeInTheDocument();
    expect(screen.getByText("Media & Review")).toBeInTheDocument();
  });
});
