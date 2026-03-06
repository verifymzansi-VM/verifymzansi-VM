import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateBusinessPage from "./page";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn().mockReturnValue("/post/create-business"),
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
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) =>
    province === "Gauteng" ? ["Johannesburg", "Pretoria"] : [],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: vi.fn().mockResolvedValue({
          data: [{ id: "mall-1", name: "Maponya Mall", location_city: "Johannesburg" }],
        }),
      }),
    }),
  }),
}));

describe("CreateBusinessPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new URLSearchParams());
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  function completeStepOne() {
    fireEvent.click(screen.getByRole("radio", { name: /Standalone Shop/i }));
    fireEvent.change(screen.getByLabelText(/Business Name/i), {
      target: { value: "Nomsa Fashion" },
    });
    fireEvent.change(screen.getByLabelText(/URL Slug/i), {
      target: { value: "nomsa-fashion" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "fashion_accessories" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  it("progresses through the wizard and shows the review step", () => {
    render(<CreateBusinessPage />);

    completeStepOne();
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/City \/ Town/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Business review")).toBeInTheDocument();
  });

  it("requires store number for mall stores", async () => {
    render(<CreateBusinessPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: /Mall Store/i }));
    });
    fireEvent.change(screen.getByLabelText(/Business Name/i), {
      target: { value: "Mall Biz" },
    });
    fireEvent.change(screen.getByLabelText(/URL Slug/i), {
      target: { value: "mall-biz" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "fashion_accessories" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/City \/ Town/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Store number is required for mall stores.")).toBeInTheDocument();
  });

  it("requires service areas for mobile services", () => {
    render(<CreateBusinessPage />);

    fireEvent.click(screen.getByRole("radio", { name: /Mobile Service/i }));
    fireEvent.change(screen.getByLabelText(/Business Name/i), {
      target: { value: "FixFast" },
    });
    fireEvent.change(screen.getByLabelText(/URL Slug/i), {
      target: { value: "fixfast" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "trade_maintenance" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/City \/ Town/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Add at least one service area.")).toBeInTheDocument();
  });

  it("keeps optional extras collapsed by default on the review step", () => {
    render(<CreateBusinessPage />);

    completeStepOne();
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/City \/ Town/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const details = screen.getByText("Optional extras").closest("details");
    expect(details).not.toHaveAttribute("open");
  });
});
