import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MzansiBusinessFilterSync } from "./filter-sync";

const { useMarketplaceStoreMock } = vi.hoisted(() => ({
  useMarketplaceStoreMock: vi.fn(),
}));

vi.mock("@/stores", () => ({
  useMarketplaceStore: useMarketplaceStoreMock,
}));

describe("MzansiBusinessFilterSync", () => {
  const setActiveArea = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useMarketplaceStoreMock.mockImplementation(
      (selector: (state: Record<string, unknown>) => unknown) => selector({ setActiveArea })
    );
  });

  it("sets the active marketplace area to MZANSI_BUSINESS on mount", async () => {
    render(<MzansiBusinessFilterSync />);

    await waitFor(() => {
      expect(setActiveArea).toHaveBeenCalledWith("MZANSI_BUSINESS");
    });
  });
});
