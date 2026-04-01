import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EditListingPage from "./page";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

const { mockMaybeSingle } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
}));
const { listingCardSpy } = vi.hoisted(() => ({
  listingCardSpy: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useParams: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn().mockResolvedValue("a".repeat(64)),
  withCsrfHeaders: (headers?: HeadersInit) => new Headers(headers),
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

vi.mock("@/components/billing/plan-gate", () => ({
  usePlanMaxPhotos: () => 5,
  usePlanMaxVideos: () => 1,
  usePlanVideoAllowed: () => true,
}));

vi.mock("@/components/listings/listing-detail-content", () => ({
  ListingDetailContent: ({
    listing,
  }: {
    listing: { title: string; attributes?: Record<string, unknown> };
  }) => (
    <div>
      <div>Listing Detail Preview</div>
      <div>{listing.title}</div>
      {listing.attributes?.brand ? <div>Brand {String(listing.attributes.brand)}</div> : null}
    </div>
  ),
}));

vi.mock("@/components/ui/media-upload", () => ({
  MediaUpload: ({ label, onChange }: { label: string; onChange?: (files: File[]) => void }) => (
    <button
      type="button"
      onClick={() => onChange?.([new File(["mock"], "logo.png", { type: "image/png" })])}
    >
      {label}
    </button>
  ),
}));

vi.mock("@/components/listings/category-picker", () => ({
  CategoryPicker: () => <div>Category Picker</div>,
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
  getTownsForCity: () => [],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  }),
}));

describe("EditListingPage", () => {
  const mockPush = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: "listing-1",
        seller_id: "user-1",
        status: "live",
        title: "Used iPhone 15",
        description: "Clean phone in excellent condition.",
        price_cents: 150000,
        category: "electronics",
        condition: "used",
        attributes: { device_type: "Smartphone", brand: "Apple", storage_gb: 256 },
        location_province: "Gauteng",
        location_city: "Johannesburg",
        location_suburb: "Sandton",
        price_negotiable: true,
        contact_methods: ["call", "whatsapp"],
        photos: ["https://example.com/photo.jpg"],
        videos: [],
        video_thumbnail: null,
        logo_url: "https://media.verifymzansi.com/listings/existing-logo.jpg",
      },
      error: null,
    });
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      push: mockPush,
      back: vi.fn(),
    });
    (useParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ id: "listing-1" });
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as unknown as typeof fetch;
    global.URL.createObjectURL = vi.fn(() => "blob:new-logo-preview");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("hydrates saved listing details and sends normalized payload on save", async () => {
    render(<EditListingPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Used iPhone 15")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Clean phone in excellent condition.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1500")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sandton")).toBeInTheDocument();
    expect(screen.getByText("Listing preview")).toBeInTheDocument();
    expect(screen.getByText("Listing Detail Preview")).toBeInTheDocument();
    expect(screen.getByText("Brand Apple")).toBeInTheDocument();
    expect(listingCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "https://media.verifymzansi.com/listings/existing-logo.jpg",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Updated and resubmitted for review", variant: "success" })
    );
    expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");

    const request = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = JSON.parse(request[1].body as string);

    expect(request[0]).toBe("/api/listings/listing-1");
    expect(payload.title).toBe("Used iPhone 15");
    expect(payload.price_zar).toBe(1500);
    expect(payload.negotiable).toBe(true);
    expect(payload.town).toBe("Sandton");
    expect(payload.contactMethods).toEqual(["call", "whatsapp"]);
    expect(payload.logo_url).toBe("https://media.verifymzansi.com/listings/existing-logo.jpg");
    expect(payload.attributes).toMatchObject({ brand: "Apple", storage_gb: 256 });
  });

  it("allows removing the existing listing logo before save", async () => {
    render(<EditListingPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Remove logo/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Remove logo/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const request = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = JSON.parse(request[1].body as string);

    expect(payload.logo_url).toBeNull();
    expect(screen.getByText("No listing logo uploaded.")).toBeInTheDocument();
  });

  it("uploads and uses a replacement listing logo", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: RequestInfo | URL) => {
        if (input === "/api/media/upload") {
          return {
            ok: true,
            json: async () => ({
              urls: ["https://media.verifymzansi.com/listings/replaced-logo.jpg"],
            }),
          };
        }

        if (input === "/api/listings/listing-1") {
          return {
            ok: true,
            json: async () => ({ success: true }),
          };
        }

        throw new Error(`Unexpected fetch call: ${String(input)}`);
      }
    );

    render(<EditListingPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Replace listing logo (optional)" })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Replace listing logo (optional)" }));

    expect(listingCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "blob:new-logo-preview",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const request = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    const payload = JSON.parse(request[1].body as string);

    expect(payload.logo_url).toBe("https://media.verifymzansi.com/listings/replaced-logo.jpg");
  });

  it("shows a safe fallback when the listing fails to load", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "PGRST301" },
    });

    render(<EditListingPage />);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Unable to load listing" })
      );
    });

    expect(mockPush).toHaveBeenCalledWith("/dashboard/listings");
    expect(screen.getByText("Unable to load listing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to listings/i })).toBeInTheDocument();
  });
});
