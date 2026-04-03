import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

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

vi.mock("@/components/layout/mobile-nav", () => ({
  MobileNav: () => <nav data-testid="mobile-nav" />,
}));

vi.mock("@/components/home/hero-banner-with-data", () => ({
  HeroBannerWithData: () => <div data-testid="hero-banner-with-data" />,
}));

vi.mock("@/components/home/hero-banner-skeleton", () => ({
  HeroBannerSkeleton: () => <div data-testid="hero-banner-skeleton" />,
}));

vi.mock("@/components/home/marketplace-previews-skeleton", () => ({
  MarketplacePreviewsSkeleton: () => <div data-testid="marketplace-previews-skeleton" />,
}));

vi.mock("@/components/home/home-mzansi-market-showcase", () => ({
  HomeMzansiMarketShowcase: () => <div data-testid="market-showcase" />,
}));

vi.mock("@/components/home/home-business-showcase", () => ({
  HomeBusinessShowcase: () => <div data-testid="business-showcase" />,
}));

vi.mock("@/components/home/home-promotions-showcase", () => ({
  HomePromotionsShowcase: () => <div data-testid="promotions-showcase" />,
}));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the current showcase sections and onboarding guide", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByTestId("hero-banner-with-data")).toBeInTheDocument();
    expect(screen.getByTestId("market-showcase")).toBeInTheDocument();
    expect(screen.getByTestId("business-showcase")).toBeInTheDocument();
    expect(screen.getByTestId("promotions-showcase")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Mzansi's Proudly Trusted Market.",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Get Started")).toBeInTheDocument();
    expect(screen.getByText("Create your profile")).toBeInTheDocument();
    expect(screen.getByText("Complete verification")).toBeInTheDocument();
    expect(screen.getByText("Choose your channel")).toBeInTheDocument();
  });

  it("uses canonical category href values", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByRole("link", { name: /Start for Free/i })).toHaveAttribute(
      "href",
      "/advertise"
    );
    expect(screen.getByRole("link", { name: /^Create Account$/i })).toHaveAttribute(
      "href",
      "/register"
    );
    expect(screen.getByRole("link", { name: /Pricing/i })).toHaveAttribute("href", "/pricing");
    expect(
      screen.getByRole("link", {
        name: /Mzansi Market Products and listings from verified sellers\./i,
      })
    ).toHaveAttribute("href", "/mzansi-market");
    expect(
      screen.getByRole("link", {
        name: /Mzansi Business Verified local businesses you can trust\./i,
      })
    ).toHaveAttribute("href", "/mzansi-business");
    expect(
      screen.getByRole("link", {
        name: /Promotions & Events Deals, launches, and events near you\./i,
      })
    ).toHaveAttribute("href", "/promotions");
  });

  it("links onboarding destinations and actions to the expected pages", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByRole("link", { name: /Start for Free/i })).toHaveAttribute(
      "href",
      "/advertise"
    );
    expect(screen.getByRole("link", { name: /^Create Account$/i })).toHaveAttribute(
      "href",
      "/register"
    );
    expect(screen.getByRole("link", { name: /Pricing/i })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: /Advertise/i })).toHaveAttribute("href", "/advertise");
    expect(screen.getByText("Create your profile")).toBeInTheDocument();
    expect(screen.getByText("Complete verification")).toBeInTheDocument();
    expect(screen.getByText("Choose your channel")).toBeInTheDocument();
  });
});
