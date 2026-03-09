import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  usePlanMaxPhotos: () => 5,
  usePlanCoverVideoAllowed: () => true,
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

  async function selectBusinessType(name: RegExp) {
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name }));
    });
  }

  function fillCoreBusinessFields({
    businessName = "Nomsa Fashion",
    slug = "nomsa-fashion",
    category = "fashion_accessories",
  } = {}) {
    fireEvent.change(screen.getByLabelText(/Business Name/i), {
      target: { value: businessName },
    });
    fireEvent.change(screen.getByLabelText(/URL Slug/i), {
      target: { value: slug },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: category },
    });
  }

  function fillStandaloneStepOneDetails() {
    fireEvent.change(screen.getByLabelText(/Street address/i), {
      target: { value: "24 Vilakazi Street" },
    });
    fireEvent.change(screen.getByLabelText(/Suburb/i), {
      target: { value: "Orlando West" },
    });
  }

  async function completeStandaloneStepOne() {
    await selectBusinessType(/Standalone Shop/i);
    fillCoreBusinessFields();
    fillStandaloneStepOneDetails();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  function completeLocationStep() {
    fireEvent.change(screen.getByLabelText(/Province/i), { target: { value: "Gauteng" } });
    fireEvent.change(screen.getByLabelText(/City \/ Town/i), {
      target: { value: "Johannesburg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }

  it.each([
    [/Mall Store/i, /Store Number/i],
    [/Standalone Shop/i, /Street address/i],
    [/Home Business/i, /Service suburb/i],
    [/Mobile Service/i, /Service Areas/i],
    [/Online Only/i, /Primary order channel/i],
    [/Market Stall/i, /Market name/i],
  ])("renders type-specific fields immediately on step 1 for %s", async (typeName, fieldLabel) => {
    render(<CreateBusinessPage />);

    await selectBusinessType(typeName);

    expect(screen.getByLabelText(fieldLabel)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });

  it("switching business types replaces fields and clears stale type-specific errors", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Standalone Shop/i);
    fillCoreBusinessFields();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Street address is required.")).toBeInTheDocument();
    expect(await screen.findByText("Suburb is required.")).toBeInTheDocument();

    await selectBusinessType(/Online Only/i);

    expect(await screen.findByLabelText(/Primary order channel/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText(/Street address/i)).not.toBeInTheDocument();
      expect(screen.queryByText("Street address is required.")).not.toBeInTheDocument();
      expect(screen.queryByText("Suburb is required.")).not.toBeInTheDocument();
    });
  });

  it("requires store number for mall stores on step 1", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Mall Store/i);
    fillCoreBusinessFields({ businessName: "Mall Biz", slug: "mall-biz" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Store number is required for mall stores.")).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });

  it("requires service areas for mobile services on step 1", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Mobile Service/i);
    fillCoreBusinessFields({
      businessName: "FixFast",
      slug: "fixfast",
      category: "trade_maintenance",
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Add at least one service area.")).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });

  it("step 2 no longer renders the business type details block", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();

    expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Street address/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Walk-in policy/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Province/i)).toBeInTheDocument();
  });

  it("progresses through the wizard and shows the review step", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    expect(screen.getByText(/Business review/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 3 of 3/i)).toBeInTheDocument();
  });

  it("renders subtype-specific details in the shared review preview", async () => {
    render(<CreateBusinessPage />);

    await selectBusinessType(/Home Business/i);
    fillCoreBusinessFields({
      businessName: "Nomsa Home Studio",
      slug: "nomsa-home-studio",
      category: "health_beauty",
    });
    fireEvent.change(screen.getByLabelText(/Service suburb/i), {
      target: { value: "Noordwyk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    completeLocationStep();

    expect(screen.getByText(/Business review/i)).toBeInTheDocument();
    expect(screen.getByText("Service suburb")).toBeInTheDocument();
    expect(screen.getByText("Noordwyk")).toBeInTheDocument();
    expect(screen.getByText("Nomsa Home Studio")).toBeInTheDocument();
  });

  it("blocks final submit when step-3 optional social URLs are invalid", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    const details = screen.getByText("Optional extras").closest("details");
    expect(details).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Optional extras"));
    fireEvent.change(screen.getByPlaceholderText("Facebook URL"), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Submit for review/i }));

    expect(screen.getByText("Enter a valid Facebook URL.")).toBeInTheDocument();
    expect(
      screen.getByText("Please fix the highlighted fields before submitting.")
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Step 3 of 3/i)).toBeInTheDocument();
  });

  it("keeps optional extras collapsed by default on the review step", async () => {
    render(<CreateBusinessPage />);

    await completeStandaloneStepOne();
    completeLocationStep();

    const details = screen.getByText("Optional extras").closest("details");
    expect(details).not.toHaveAttribute("open");
  });
});
