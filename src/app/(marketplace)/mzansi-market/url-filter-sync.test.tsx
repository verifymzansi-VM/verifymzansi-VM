import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MarketplaceUrlFilterSync } from "./url-filter-sync";
import { useSearchParams } from "next/navigation";

const { useSearchParamsMock, useMarketplaceStoreMock } = vi.hoisted(() => ({
  useSearchParamsMock: vi.fn(),
  useMarketplaceStoreMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: useSearchParamsMock,
}));

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
}));

describe("MarketplaceUrlFilterSync", () => {
  const setFilter = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useMarketplaceStoreMock.mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) => selector({ setFilter })
    );
  });

  it("hydrates canonical category and query from URL params", async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("category=vehicles&q=iphone") as unknown as ReturnType<
        typeof useSearchParams
      >
    );

    render(<MarketplaceUrlFilterSync />);

    await waitFor(() => {
      expect(setFilter).toHaveBeenCalledWith("category", "vehicles");
      expect(setFilter).toHaveBeenCalledWith("query", "iphone");
    });
  });

  it("maps legacy category aliases", async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("category=cars") as unknown as ReturnType<typeof useSearchParams>
    );

    render(<MarketplaceUrlFilterSync />);

    await waitFor(() => {
      expect(setFilter).toHaveBeenCalledWith("category", "vehicles");
      expect(setFilter).toHaveBeenCalledWith("query", undefined);
    });

    vi.clearAllMocks();
    useMarketplaceStoreMock.mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) => selector({ setFilter })
    );
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("category=jobs") as unknown as ReturnType<typeof useSearchParams>
    );

    render(<MarketplaceUrlFilterSync />);

    await waitFor(() => {
      expect(setFilter).toHaveBeenCalledWith("category", "jobs_services");
    });
  });

  it("trims query and clears invalid or missing params", async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("category=not_real&q=%20%20tv%20%20") as unknown as ReturnType<
        typeof useSearchParams
      >
    );

    render(<MarketplaceUrlFilterSync />);

    await waitFor(() => {
      expect(setFilter).toHaveBeenCalledWith("category", undefined);
      expect(setFilter).toHaveBeenCalledWith("query", "tv");
    });

    vi.clearAllMocks();
    useMarketplaceStoreMock.mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) => selector({ setFilter })
    );
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("") as unknown as ReturnType<typeof useSearchParams>
    );

    render(<MarketplaceUrlFilterSync />);

    await waitFor(() => {
      expect(setFilter).toHaveBeenCalledWith("query", undefined);
    });
  });
});
