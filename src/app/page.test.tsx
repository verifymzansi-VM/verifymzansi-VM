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

    const hero = screen.getByTestId("hero-banner-with-data");
    const market = screen.getByTestId("market-showcase");
    const business = screen.getByTestId("business-showcase");
    const promotions = screen.getByTestId("promotions-showcase");

    expect(hero).toBeInTheDocument();
    expect(market).toBeInTheDocument();
    expect(business).toBeInTheDocument();
    expect(promotions).toBeInTheDocument();
    expect(hero.compareDocumentPosition(market)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(market.compareDocumentPosition(business)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(business.compareDocumentPosition(promotions)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Promote, discover, and build trust on VerifyMzansi",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("New to VerifyMzansi?")).toBeInTheDocument();
    expect(screen.getByText("Create your profile")).toBeInTheDocument();
    expect(screen.getByText("Complete verification")).toBeInTheDocument();
    expect(screen.getByText("Choose the surface that fits your goal")).toBeInTheDocument();
  });

  it("uses canonical category href values", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByRole("link", { name: /Start advertising/i })).toHaveAttribute(
      "href",
      "/advertise"
    );
    expect(screen.getByRole("link", { name: /^Create your account$/i })).toHaveAttribute(
      "href",
      "/register"
    );
    expect(screen.getByRole("link", { name: /See pricing and growth plans/i })).toHaveAttribute(
      "href",
      "/pricing"
    );
    expect(
      screen.getByRole("link", {
        name: /Mzansi Market Showcase products, listings, and everyday offers with trusted visibility\./i,
      })
    ).toHaveAttribute("href", "/mzansi-market");
    expect(
      screen.getByRole("link", {
        name: /Mzansi Business Build a business presence that helps customers discover and trust your brand\./i,
      })
    ).toHaveAttribute("href", "/mzansi-business");
    expect(
      screen.getByRole("link", {
        name: /Promotions & Events Promote products, services, launches, and campaigns that need immediate reach\./i,
      })
    ).toHaveAttribute("href", "/promotions");
  });

  it("links onboarding destinations and actions to the expected pages", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByRole("link", { name: /Start advertising/i })).toHaveAttribute(
      "href",
      "/advertise"
    );
    expect(screen.getByRole("link", { name: /^Create your account$/i })).toHaveAttribute(
      "href",
      "/register"
    );
    expect(screen.getByRole("link", { name: /See pricing and growth plans/i })).toHaveAttribute(
      "href",
      "/pricing"
    );
    expect(screen.getByRole("link", { name: /Explore advertiser solutions/i })).toHaveAttribute(
      "href",
      "/advertise"
    );
    expect(screen.getByText("Create your profile")).toBeInTheDocument();
    expect(screen.getByText("Complete verification")).toBeInTheDocument();
    expect(screen.getByText("Choose the surface that fits your goal")).toBeInTheDocument();
  });
});
