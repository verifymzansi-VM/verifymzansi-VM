import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MzansiMarketGrid } from "./grid";

const { createClientMock, useMarketplaceStoreMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  useMarketplaceStoreMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
}));

vi.mock("@/components/listings/listing-skeleton", () => ({
  ListingGridSkeleton: () => <div data-testid="listing-skeleton" />,
}));

type QueryResult = {
  data: Record<string, unknown>[] | null;
  error: { code?: string | null; message?: string | null } | null;
  count?: number | null;
};

function createListingsQuery(result: QueryResult) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({
      data: result.data,
      error: result.error,
      count: result.count ?? null,
    }),
  };

  return query;
}

function createSupabaseClientMock(queryResult: QueryResult) {
  const listingsQuery = createListingsQuery(queryResult);
  const sellerQuery = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: [] }),
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "listings") return listingsQuery;
      if (table === "seller_profiles") return sellerQuery;
      return sellerQuery;
    }),
  };
}

describe("MzansiMarketGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMarketplaceStoreMock.mockReturnValue({
      filters: {
        category: undefined,
        province: undefined,
        city: undefined,
        priceMin: undefined,
        priceMax: undefined,
        condition: undefined,
        sort: "newest",
        query: undefined,
        attributes: {},
      },
      page: 1,
      setPage: vi.fn(),
    });
  });

  it("renders a schema outage message for PGRST205", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    createClientMock.mockReturnValue(
      createSupabaseClientMock({
        data: null,
        error: {
          code: "PGRST205",
          message: "Could not find the table 'public.listings' in the schema cache",
        },
      }) as never
    );

    render(<MzansiMarketGrid />);

    await waitFor(() => {
      expect(screen.getByText("Marketplace temporarily unavailable")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        "The marketplace database schema is not available yet. Please retry in a moment."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.getByText("PGRST205")).toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("keeps the normal empty state when query succeeds with no rows", async () => {
    createClientMock.mockReturnValue(
      createSupabaseClientMock({
        data: [],
        error: null,
        count: 0,
      }) as never
    );

    render(<MzansiMarketGrid />);

    await waitFor(() => {
      expect(screen.getByText("No listings yet")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Be the first to post a verified ad on Mzansi Market.")
    ).toBeInTheDocument();
  });
});
