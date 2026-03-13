import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePathname } from "next/navigation";
import { MarketplaceSectionNav } from "./marketplace-section-nav";

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

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

const usePathnameMock = vi.mocked(usePathname);

describe("MarketplaceSectionNav", () => {
  it("renders all four marketplace destinations with canonical hrefs", () => {
    usePathnameMock.mockReturnValue("/mzansi-market");

    render(<MarketplaceSectionNav />);

    expect(screen.getByRole("link", { name: /mzansi market/i })).toHaveAttribute(
      "href",
      "/mzansi-market"
    );
    expect(screen.getByRole("link", { name: /mzansi business/i })).toHaveAttribute(
      "href",
      "/mzansi-business"
    );
    expect(screen.getByRole("link", { name: /promotions/i })).toHaveAttribute(
      "href",
      "/promotions"
    );
    expect(screen.getByRole("link", { name: /events/i })).toHaveAttribute(
      "href",
      "/promotions/events"
    );
  });

  it("marks the dedicated events route as active without also activating promotions", () => {
    usePathnameMock.mockReturnValue("/promotions/events");

    render(<MarketplaceSectionNav />);

    expect(screen.getByRole("link", { name: /events/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /promotions/i })).not.toHaveAttribute("aria-current");
  });

  it("renders the mobile variant copy for use inside sheets and drawers", () => {
    usePathnameMock.mockReturnValue("/promotions");

    render(
      <MarketplaceSectionNav
        variant="mobile"
        heading="Choose a section"
        description="Open this inside mobile filters."
      />
    );

    expect(screen.getByText("Choose a section")).toBeInTheDocument();
    expect(screen.getByText("Open this inside mobile filters.")).toBeInTheDocument();
  });
});
