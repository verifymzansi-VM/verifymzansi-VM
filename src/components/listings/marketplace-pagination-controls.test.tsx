import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketplacePaginationControls } from "@/components/listings/marketplace-pagination-controls";

const notice = /Showing the first 2.400 results\. Narrow your search to see more\./;

describe("marketplace page links", () => {
  it("says how far the page links reach on the last page only", () => {
    const { rerender } = render(
      <MarketplacePaginationControls
        page={99}
        totalPages={100}
        limitedTo={2400}
        onPageChange={vi.fn()}
      />
    );
    expect(screen.queryByText(notice)).toBeNull();
    rerender(
      <MarketplacePaginationControls
        page={100}
        totalPages={100}
        limitedTo={2400}
        onPageChange={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(notice);
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  });

  it("adds nothing when every result has a page", () => {
    render(<MarketplacePaginationControls page={3} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });
});
