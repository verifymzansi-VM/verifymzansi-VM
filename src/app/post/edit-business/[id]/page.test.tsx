import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  expectFoundationPostFields,
  installFoundationPostFetch,
} from "@/test/foundation-post-transport";
import EditBusinessPage from "./page";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

const { businessLayoutRouterSpy } = vi.hoisted(() => ({
  businessLayoutRouterSpy: vi.fn(),
}));

// Has its own tests; here it would take a fetch response meant for the form.
vi.mock("@/components/business-verification/use-registered-office", () => ({
  UseRegisteredOffice: () => null,
}));

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

vi.mock("@/components/business/layouts/business-layout-router", () => ({
  BusinessLayoutRouter: (props: {
    business: { business_name: string };
    layoutMode?: "public" | "review";
  }) => {
    businessLayoutRouterSpy(props);
    return <div data-testid="layout-router">{props.business.business_name}</div>;
  },
}));

vi.mock("@/components/business/business-detail-content", () => ({
  BusinessDetailsCard: () => <div>Business Details Card</div>,
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({
    label,
    onChange,
    error,
  }: {
    label: string;
    onChange?: (files: File[]) => void;
    error?: string;
  }) => {
    const normalizedLabel = label.toLowerCase();
    const isThumbnail = normalizedLabel.includes("thumbnail");
    const isVideo = normalizedLabel.includes("video") && !isThumbnail;
    const createFile = (name: string, type: string) => new File(["mock"], name, { type });
    const files = normalizedLabel.includes("profile photos")
      ? [createFile("photo-1.png", "image/png"), createFile("photo-2.png", "image/png")]
      : [
          createFile(
            isVideo ? "clip.mp4" : isThumbnail ? "thumb.png" : "image.png",
            isVideo ? "video/mp4" : "image/png"
          ),
        ];

    return (
      <>
        <button type="button" onClick={() => onChange?.(files)}>
          {label}
        </button>
        {error && <p>{error}</p>}
      </>
    );
  },
}));

vi.mock("@/components/billing/plan-gate", () => ({
  usePlanMaxPhotos: () => 5,
  usePlanVideoAllowed: () => true,
}));

vi.mock("@/lib/media/compress-before-upload", () => ({
  compressVideoForUpload: vi.fn(async (file: File) => file),
}));

vi.mock("@/lib/constants/sa-provinces", () => ({
  getProvinceNames: () => ["Gauteng", "Western Cape"],
  getCitiesForProvince: (province: string) =>
    province === "Gauteng" ? ["Johannesburg", "Pretoria"] : [],
  getTownsForCity: (province: string, city: string) =>
    province === "Gauteng" && city === "Johannesburg" ? ["Noordwyk", "Midrand"] : [],
}));

describe("EditBusinessPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();
  let fetchMock: Mock;
  let termsLoaded: () => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: mockPush });
    (useParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ id: "business-1" });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    global.URL.createObjectURL = vi.fn(() => "blob:business-media-preview");
    global.URL.revokeObjectURL = vi.fn();

    ({ api: fetchMock, termsLoaded } = installFoundationPostFetch(
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            business: {
              id: "business-1",
              status: "live",
              revision: 3,
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
          json: async () => ({ success: true, pendingReview: true }),
        })
    ));
  });

  function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => body,
    };
  }

  it("does not claim a saved update was submitted without server confirmation", async () => {
    render(<EditBusinessPage />);
    await termsLoaded();
    await waitFor(() => expect(screen.getByDisplayValue("Nomsa Home Studio")).toBeInTheDocument());
    fetchMock
      .mockReset()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Business updated!" })
      )
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Edit submitted for review" })
    );
  });

  it("reports a business loaded without its revision as a failed load", async () => {
    fetchMock.mockReset().mockResolvedValueOnce(
      jsonResponse({
        business: { id: "business-1", status: "live", business_name: "Nomsa Home Studio" },
      })
    );

    render(<EditBusinessPage />);

    // The page keeps its restored layout and shows the load error above the form.
    expect(await screen.findByText("Failed to load business")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Nomsa Home Studio")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hydrates the saved type-specific details and sends business_details on save", async () => {
    render(<EditBusinessPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Nomsa Home Studio")).toBeInTheDocument();
    });

    expect(screen.getByText("Profile preview")).toBeInTheDocument();
    expect(screen.getByTestId("layout-router")).toBeInTheDocument();
    expect(businessLayoutRouterSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutMode: "review" })
    );
    expect(screen.getByText("Nomsa Home Studio")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const payload = JSON.parse(secondCall[1].body as string);

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Edit submitted for review", variant: "success" })
    );
    expect(mockPush).toHaveBeenCalledWith(
      "/dashboard/listings?area=MZANSI_BUSINESS&updated=business&review=pending"
    );
    // Home businesses do not publish their address, so the server would drop the pin anyway.
    expect(payload.map_directions).toBeUndefined();
    expect(
      screen.getByText(/A location pin is only shown when you publish your address/)
    ).toBeInTheDocument();
    expect(payload.business_details).toMatchObject({
      type: "home_business",
      service_suburb: "Noordwyk",
      appointment_required: true,
      customer_pickup_allowed: false,
    });
    expectFoundationPostFields(payload, { expectedRevision: 3 });
  });

  it("keeps unsaved changes on the form when an earlier business edit is pending", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          business: {
            id: "business-1",
            status: "live",
            revision: 3,
            business_type: "home_business",
            business_name: "Nomsa Home Studio",
            slug: "nomsa-home-studio",
            description: "A home-based studio.",
            category: "health_beauty",
            location_province: "Gauteng",
            location_city: "Johannesburg",
            phone: "0821234567",
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
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ code: "pending_edit_exists" }),
      });

    render(<EditBusinessPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Nomsa Home Studio")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/Your latest changes were not submitted/)).toBeInTheDocument();
    });
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("collapses legacy online delivery details into simple delivery availability on save", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          business: {
            id: "business-2",
            status: "live",
            revision: 9,
            business_type: "online_only",
            business_name: "Mzansi Online",
            slug: "mzansi-online",
            description: "Online store.",
            category: "electronics_tech",
            location_province: "Gauteng",
            location_city: "Johannesburg",
            store_number: null,
            map_directions: null,
            phone: "",
            whatsapp: "",
            email: "hello@orders.example.com",
            website: "",
            logo_url: "",
            cover_photo: "",
            cover_video: "",
            video_thumbnail: "",
            gallery_photos: [],
            services_offered: [],
            payment_methods_accepted: [],
            delivery_options: [],
            social_links: {},
            operating_hours: {},
            service_areas: null,
            business_details: {
              type: "online_only",
              primary_order_channel: "website",
              order_url: "https://orders.example.com",
              delivery_regions: ["Nationwide"],
              support_response_time: "Within 2 hours",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, pendingReview: true }),
      });

    render(<EditBusinessPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Mzansi Online")).toBeInTheDocument();
    });

    expect(screen.getByRole("checkbox", { name: /I deliver orders/i })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCall = fetchMock.mock.calls[1];
    const payload = JSON.parse(secondCall[1].body as string);

    expect(payload.delivery_options).toEqual(["delivery"]);
    expect(payload.category_details.customer_access).toMatchObject({
      methods: expect.arrayContaining(["online", "delivery"]),
      nationwide: true,
    });
    expect(payload.business_details).toMatchObject({
      type: "online_only",
      order_url: "https://orders.example.com",
      support_response_time: "Within 2 hours",
    });
    expectFoundationPostFields(payload, { expectedRevision: 9 });
  });

  it("blocks saving when replacement gallery photos upload only partially succeeds", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          business: {
            id: "business-1",
            status: "live",
            revision: 3,
            business_type: "home_business",
            business_name: "Nomsa Home Studio",
            slug: "nomsa-home-studio",
            description: "A home-based studio.",
            category: "health_beauty",
            location_province: "Gauteng",
            location_city: "Johannesburg",
            store_number: null,
            map_directions: "",
            phone: "0821234567",
            whatsapp: "",
            email: "",
            website: "",
            logo_url: "",
            cover_photo: "",
            cover_video: "",
            video_thumbnail: "",
            gallery_photos: [],
            services_offered: [],
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
              visitor_notes: "",
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            urls: ["https://media.verifymzansi.com/media/business_gallery/user/photo-1.png"],
            errors: ['"photo-2.png": upload failed'],
          },
          { ok: true, status: 207 }
        )
      );

    render(<EditBusinessPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Nomsa Home Studio")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Profile photos$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(
      await screen.findByText(
        "One or more profile photos failed to upload. Retry the selected files."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Selected business media could not be uploaded. Retry the highlighted files and try again."
      )
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("falls back to the server upload path when a replacement promo video upload fails", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (input === "/api/businesses/business-1?owner=1") {
        const existingBusiness = {
          business: {
            id: "business-1",
            status: "live",
            revision: 3,
            business_type: "home_business",
            business_name: "Nomsa Home Studio",
            slug: "nomsa-home-studio",
            description: "A home-based studio.",
            category: "health_beauty",
            location_province: "Gauteng",
            location_city: "Johannesburg",
            store_number: null,
            map_directions: "",
            phone: "0821234567",
            whatsapp: "",
            email: "",
            website: "",
            logo_url: "",
            cover_photo: "",
            cover_video: "",
            video_thumbnail: "",
            gallery_photos: [],
            services_offered: [],
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
              visitor_notes: "",
            },
          },
        };

        return jsonResponse(existingBusiness, { status: 200 });
      }

      if (input === "/api/media/upload") {
        return jsonResponse({
          urls: ["https://media.verifymzansi.com/media/business_cover/user/video-fallback.mp4"],
        });
      }

      return jsonResponse({ success: true }, { status: 200 });
    });

    render(<EditBusinessPage />);
    await termsLoaded();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Nomsa Home Studio")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Video$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/businesses/business-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining(
            '"cover_video":"https://media.verifymzansi.com/media/business_cover/user/video-fallback.mp4"'
          ),
        })
      );
    });

    expect(screen.queryByText("Promo video upload failed. Retry the selected file.")).toBeNull();
    expect(mockPush).toHaveBeenCalled();
  });
});
