import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MzansiBusinessFilterSync } from "./filter-sync";

const {
  replaceMock,
  usePathnameMock,
  useRouterMock,
  useSearchParamsMock,
  useMarketplaceStoreMock,
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
  useMarketplaceStoreMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
}));

describe("MzansiBusinessFilterSync", () => {
  const hydrateFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/mzansi-business");
    useRouterMock.mockReturnValue({ replace: replaceMock });
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams("category=food_dining&q=coffee") as ReturnType<typeof useSearchParamsMock>
    );
    useMarketplaceStoreMock.mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) =>
        selector({
          hydrateFilters,
          filters: {
            query: "coffee",
            businessCategory: "food_dining",
            businessType: undefined,
            province: undefined,
            city: undefined,
            mall: undefined,
          },
          page: 1,
        })
    );
  });

  it("hydrates business filters into the MZANSI_BUSINESS area on mount", async () => {
    render(<MzansiBusinessFilterSync />);

    await waitFor(() => {
      expect(hydrateFilters).toHaveBeenCalledWith(
        "MZANSI_BUSINESS",
        expect.objectContaining({
          query: "coffee",
          businessCategory: "food_dining",
        }),
        1
      );
    });
    expect(replaceMock).toHaveBeenCalledWith("/mzansi-business?q=coffee&category=food_dining", {
      scroll: false,
    });
  });
});
