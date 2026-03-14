import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Footer } from "./footer";

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

vi.mock("../shared/brand-logo", () => ({
  BrandLogo: () => <div data-testid="brand-logo" />,
}));

describe("Footer", () => {
  it("shows promotions browsing and advertiser entry points", () => {
    render(<Footer />);

    expect(screen.getByRole("link", { name: /^Promotions & Events$/i })).toHaveAttribute(
      "href",
      "/promotions"
    );
    expect(screen.getByRole("link", { name: /Advertise in Promotions & Events/i })).toHaveAttribute(
      "href",
      "/post/create-promotion"
    );
  });
});
