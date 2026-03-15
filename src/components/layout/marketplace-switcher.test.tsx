/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePathname } from "next/navigation";
import { MarketplaceSwitcher } from "./marketplace-switcher";

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

describe("MarketplaceSwitcher", () => {
  it("renders all three area tabs with their canonical hrefs", () => {
    usePathnameMock.mockReturnValue("/");

    render(<MarketplaceSwitcher />);

    expect(screen.getByRole("link", { name: "Mzansi Market" })).toHaveAttribute(
      "href",
      "/mzansi-market"
    );
    expect(screen.getByRole("link", { name: "Mzansi Business" })).toHaveAttribute(
      "href",
      "/mzansi-business"
    );
    expect(screen.getByRole("link", { name: "Promotion & Events" })).toHaveAttribute(
      "href",
      "/promotions"
    );
  });

  it("marks the current area as active based on the pathname", () => {
    usePathnameMock.mockReturnValue("/mzansi-business/fixfast");

    render(<MarketplaceSwitcher />);

    expect(screen.getByRole("link", { name: "Mzansi Business" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Mzansi Market" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Promotion & Events" })).not.toHaveAttribute(
      "aria-current"
    );
  });
});
