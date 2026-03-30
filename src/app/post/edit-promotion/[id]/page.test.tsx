import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditPromotionPage from "./page";
import { useParams, useRouter } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useParams: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
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

vi.mock("@/components/listings/promotion-detail-content", () => ({
  PromotionDetailContent: ({
    promotion,
    linkedBusiness,
  }: {
    promotion: { title: string };
    linkedBusiness: { business_name?: string | null } | null;
  }) => (
    <div>
      <div>Promotion Detail Preview</div>
      <div>{promotion.title}</div>
      <div>{linkedBusiness?.business_name ?? "No linked business"}</div>
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
  getTownsForCity: (province: string, city: string) =>
    province === "Gauteng" && city === "Johannesburg" ? ["Noordwyk", "Midrand"] : [],
}));

vi.mock("@/components/billing/plan-gate", () => ({
  usePlanMaxPhotos: () => 5,
  usePlanMaxVideos: () => 1,
  usePlanVideoAllowed: () => true,
}));

describe("EditPromotionPage", () => {
  const mockPush = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ id: "promotion-1" });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          promotion: {
            id: "promotion-1",
            title: "Night Market",
            description: "Community event with food, music, and stalls.",
            promotion_type: "event",
            category: "Live Music",
            category_key: "events_entertainment",
            price_cents: 5000,
            price_negotiable: false,
            location_province: "Gauteng",
            location_city: "Johannesburg",
            contact_methods: ["call", "form"],
            start_date: "2099-03-10T00:00:00.000Z",
            end_date: "2099-03-12T00:00:00.000Z",
            photos: ["https://example.com/promo.jpg"],
            videos: [],
            video_thumbnail: "",
            business_id: "business-1",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          businesses: [{ id: "business-1", business_name: "Nomsa Kitchen" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      }) as unknown as typeof fetch;
  });

  it("hydrates saved promotion details and sends normalized payload on save", async () => {
    render(<EditPromotionPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Night Market")).toBeInTheDocument();
    });

    expect(
      screen.getByDisplayValue("Community event with food, music, and stalls.")
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("50")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2099-03-10")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2099-03-12")).toBeInTheDocument();
    expect(screen.getByText("Promotion preview")).toBeInTheDocument();
    expect(screen.getByText("Promotion Detail Preview")).toBeInTheDocument();
    expect(screen.getAllByText("Nomsa Kitchen").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    const request = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[2];
    const payload = JSON.parse(request[1].body as string);

    expect(request[0]).toBe("/api/promotions/promotion-1");
    expect(payload.title).toBe("Night Market");
    expect(payload.price_zar).toBe(50);
    expect(payload.contact_methods).toEqual(["call", "form"]);
    expect(payload.business_id).toBe("business-1");
    expect(payload.start_date).toBe("2099-03-10T00:00:00.000Z");
    expect(payload.end_date).toBe("2099-03-12T00:00:00.000Z");
  });

  it("shows the four visible promotion categories on the edit form", async () => {
    render(<EditPromotionPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Promotion Type")).toBeInTheDocument();
    });

    const typeSelect = screen.getByLabelText("Promotion Type");

    expect(screen.getByRole("option", { name: "Deals" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Promotions" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ads" })).toBeInTheDocument();
    expect(typeSelect).toHaveValue("event");
  });
});
