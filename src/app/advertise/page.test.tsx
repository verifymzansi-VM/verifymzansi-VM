import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdvertisePage from "./page";

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

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="footer" />,
}));

vi.mock("@/components/layout/trust-strip", () => ({
  TrustStrip: () => <div data-testid="trust-strip" />,
}));

describe("AdvertisePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders advertiser landing content and key routes", () => {
    render(<AdvertisePage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Advertise on VerifyMzansi" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View pricing/i })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: /Choose a post type/i })).toHaveAttribute(
      "href",
      "/post/create"
    );
    expect(screen.getByRole("link", { name: /Explore Tourism & Events/i })).toHaveAttribute(
      "href",
      "/tourism-events"
    );
    expect(screen.getByRole("link", { name: /Create marketplace listing/i })).toHaveAttribute(
      "href",
      "/post/create-listing"
    );
    expect(screen.getByRole("link", { name: /Create business profile/i })).toHaveAttribute(
      "href",
      "/post/create-business"
    );
    expect(screen.getByRole("link", { name: /List tourism business/i })).toHaveAttribute(
      "href",
      "/post/create-tourism"
    );
    expect(screen.getByRole("link", { name: /Create event/i })).toHaveAttribute(
      "href",
      "/post/create-tourism?type=event"
    );
    expect(screen.getByRole("link", { name: /Browse Mzansi Business/i })).toHaveAttribute(
      "href",
      "/mzansi-business"
    );
  });
});
