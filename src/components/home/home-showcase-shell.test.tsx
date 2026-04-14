import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeShowcaseShell } from "./home-showcase-shell";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("HomeShowcaseShell", () => {
  it("renders the shared showcase frame with heading, copy, CTA, and children", () => {
    render(
      <HomeShowcaseShell
        badge="Mzansi Market"
        title="Latest on Mzansi Market"
        description="Verified sellers. Real products."
        href="/mzansi-market"
        ctaLabel="View All Listings"
        tone="green"
      >
        <div data-testid="shell-children">Rail content</div>
      </HomeShowcaseShell>
    );

    expect(screen.getByText("Mzansi Market")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Latest on Mzansi Market" })).toBeInTheDocument();
    expect(screen.getByText("Verified sellers. Real products.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View All Listings/i })).toHaveAttribute(
      "href",
      "/mzansi-market"
    );
    expect(screen.getByTestId("shell-children")).toBeInTheDocument();
  });
});
