import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MzansiMarketGrid } from "./grid";

const { useMarketplaceStoreMock, fetchMock } = vi.hoisted(() => ({
  useMarketplaceStoreMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
}));

vi.mock("@/components/listings/listing-skeleton", () => ({
  ListingGridSkeleton: () => <div data-testid="listing-skeleton" />,
}));

describe("MzansiMarketGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
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
      resetFilters: vi.fn(),
    });
  });

  it("renders a schema outage message for PGRST205", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: "Marketplace temporarily unavailable",
        code: "PGRST205",
        detail: "The marketplace database schema is not available yet. Please retry in a moment.",
      }),
    });

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
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        listings: [],
        sellers: [],
        total: 0,
        page: 1,
        limit: 24,
      }),
    });

    render(<MzansiMarketGrid />);

    await waitFor(() => {
      expect(screen.getByText("No listings yet")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Be the first to post a verified ad on Mzansi Market.")
    ).toBeInTheDocument();
  });
});
