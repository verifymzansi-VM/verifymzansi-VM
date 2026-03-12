import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditBusinessPage from "./page";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useParams: vi.fn(),
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
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("@/components/business/business-detail-content", () => ({
  BusinessDetailContent: ({
    business,
  }: {
    business: { business_name: string; business_details?: { service_suburb?: string } | null };
  }) => (
    <div>
      <div>Business Detail Preview</div>
      <div>{business.business_name}</div>
      {business.business_details?.service_suburb ? (
        <div>{business.business_details.service_suburb}</div>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/components/billing/plan-gate", () => ({
  usePlanMaxPhotos: () => 5,
  usePlanCoverVideoAllowed: () => true,
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) =>
    province === "Gauteng" ? ["Johannesburg", "Pretoria"] : [],
}));

describe("EditBusinessPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ id: "business-1" });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          business: {
            id: "business-1",
            business_type: "home_business",
            business_name: "Nomsa Home Studio",
            slug: "nomsa-home-studio",
            description: "A home-based studio.",
            category: "health_beauty",
            location_province: "Gauteng",
            location_city: "Johannesburg",
            store_number: null,
            map_directions: "https://maps.example.com/home-studio",
            phone: "0821234567",
            whatsapp: "",
            email: "hello@example.com",
            website: "",
            logo_url: "",
            cover_photo: "",
            cover_video: "",
            video_thumbnail: "",
            gallery_photos: [],
            services_offered: ["Braids"],
            payment_methods_accepted: [],
            delivery_options: [],
            social_links: {},
            operating_hours: {},
            service_areas: null,
            business_details: {
              type: "home_business",
              service_suburb: "Noordwyk",
              appointment_required: true,
              customer_pickup_allowed: false,
              visitor_notes: "Visits by appointment only.",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      }) as unknown as typeof fetch;
  });

  it("hydrates the saved type-specific details and sends business_details on save", async () => {
    render(<EditBusinessPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Noordwyk")).toBeInTheDocument();
    });

    expect(screen.getByText("Home Business")).toBeInTheDocument();
    expect(screen.getByText("Business preview")).toBeInTheDocument();
    expect(screen.getByText("Business Detail Preview")).toBeInTheDocument();
    expect(screen.getByText("Nomsa Home Studio")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const secondCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    const payload = JSON.parse(secondCall[1].body as string);

    expect(payload.map_directions).toBe("https://maps.example.com/home-studio");
    expect(payload.business_details).toMatchObject({
      type: "home_business",
      service_suburb: "Noordwyk",
      appointment_required: true,
      customer_pickup_allowed: false,
    });
  });
});
