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
  it("renders the area title, a single View all link, and children", () => {
    render(
      <HomeShowcaseShell title="Mzansi Market" href="/mzansi-market" tone="green">
        <div data-testid="shell-children">Rail content</div>
      </HomeShowcaseShell>
    );

    expect(screen.getByRole("heading", { name: "Mzansi Market" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all Mzansi Market" })).toHaveAttribute(
      "href",
      "/mzansi-market"
    );
    expect(screen.getByTestId("shell-children")).toBeInTheDocument();
  });
});
