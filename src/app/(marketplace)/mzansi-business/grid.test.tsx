import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MzansiBusinessGrid } from "./grid";

const { useMarketplaceStoreMock } = vi.hoisted(() => ({
  useMarketplaceStoreMock: vi.fn(),
}));
const { businessCardSpy } = vi.hoisted(() => ({
  businessCardSpy: vi.fn(),
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

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
}));

vi.mock("@/components/listings/listing-skeleton", () => ({
  ListingGridSkeleton: () => <div data-testid="listing-skeleton" />,
}));

vi.mock("@/components/listings/business-card", () => ({
  BusinessCard: (props: { businessName: string }) => {
    businessCardSpy(props);
    return <div>{props.businessName}</div>;
  },
}));

function mockFetchResponse(payload: Record<string, unknown>, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => payload,
  });
}

describe("MzansiBusinessGrid", () => {
  const fetchMock = vi.fn();
  const setPage = vi.fn();
  const resetFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as typeof fetch;
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        sort: "newest",
        attributes: {},
        businessCategory: undefined,
        businessType: undefined,
      },
      page: 1,
      setPage,
      resetFilters,
    });
  });

  it("loads businesses and sends category/page params", async () => {
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        sort: "newest",
        attributes: {},
        businessCategory: "fashion_accessories",
        businessType: undefined,
      },
      page: 2,
      setPage,
      resetFilters,
    });

    fetchMock.mockImplementation(() =>
      mockFetchResponse({
        businesses: [
          {
            id: "biz-1",
            business_type: "standalone_shop",
            business_name: "Thread Theory",
            description: "Tailored fashion",
            cover_photo: null,
            logo_url: null,
            gallery_photos: null,
            location_province: "Gauteng",
            location_city: "Johannesburg",
            category: "fashion_accessories",
            boost_until: null,
            featured_until: null,
            service_areas: null,
          },
        ],
        total: 26,
        page: 2,
        limit: 24,
      })
    );

    render(<MzansiBusinessGrid />);

    await waitFor(() => {
      expect(screen.getByText("Thread Theory")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/businesses?page=2&limit=24&category=fashion_accessories",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(businessCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: null,
      })
    );
    expect(screen.getByText(/26/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 filter active");
  });

  it("passes business logos through to business cards", async () => {
    fetchMock.mockImplementation(() =>
      mockFetchResponse({
        businesses: [
          {
            id: "biz-logo",
            business_type: "standalone_shop",
            business_name: "Logo Tailors",
            description: "Tailored fashion",
            cover_photo: null,
            cover_video: null,
            video_thumbnail: null,
            logo_url: "https://media.verifymzansi.com/business/logo.jpg",
            gallery_photos: null,
            location_province: "Gauteng",
            location_city: "Johannesburg",
            category: "fashion_accessories",
            boost_until: null,
            featured_until: null,
            service_areas: null,
          },
        ],
        total: 1,
        page: 1,
        limit: 24,
      })
    );

    render(<MzansiBusinessGrid />);

    await waitFor(() => {
      expect(screen.getByText("Logo Tailors")).toBeInTheDocument();
    });

    expect(businessCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "https://media.verifymzansi.com/business/logo.jpg",
      })
    );
  });

  it("shows the unfiltered empty state with a business CTA", async () => {
    fetchMock.mockImplementation(() =>
      mockFetchResponse({
        businesses: [],
        total: 0,
        page: 1,
        limit: 24,
      })
    );

    render(<MzansiBusinessGrid />);

    await waitFor(() => {
      expect(screen.getByText("No representative profiles yet")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: /create business profile/i })).toHaveAttribute(
      "href",
      "/post/create-business"
    );
  });

  it("shows a filtered empty state and clears filters", async () => {
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        sort: "newest",
        attributes: {},
        businessCategory: "food_dining",
        businessType: undefined,
      },
      page: 1,
      setPage,
      resetFilters,
    });

    fetchMock.mockImplementation(() =>
      mockFetchResponse({
        businesses: [],
        total: 0,
        page: 1,
        limit: 24,
      })
    );

    render(<MzansiBusinessGrid />);

    await waitFor(() => {
      expect(screen.getByText("No businesses match your filters")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(resetFilters).toHaveBeenCalled();
  });

  it("shows retry UI when the fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network down")).mockImplementationOnce(() =>
      mockFetchResponse({
        businesses: [],
        total: 0,
        page: 1,
        limit: 24,
      })
    );

    render(<MzansiBusinessGrid />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load businesses")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("renders pagination controls and advances pages", async () => {
    fetchMock.mockImplementation(() =>
      mockFetchResponse({
        businesses: [
          {
            id: "biz-2",
            business_type: "standalone_shop",
            business_name: "FixFast",
            description: "Trade services",
            cover_photo: null,
            logo_url: null,
            gallery_photos: null,
            location_province: "Gauteng",
            location_city: "Pretoria",
            category: "trade_maintenance",
            boost_until: null,
            featured_until: null,
            service_areas: null,
          },
        ],
        total: 60,
        page: 1,
        limit: 24,
      })
    );

    render(<MzansiBusinessGrid />);

    await waitFor(() => {
      expect(screen.getByText("FixFast")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(setPage).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
  });
});
