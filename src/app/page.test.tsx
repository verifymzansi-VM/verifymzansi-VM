import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage, { metadata } from "./page";

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

  it("leads with the showroom, then the three areas and their showcase rails", async () => {
    const ui = await HomePage();
    render(ui);

    const heroBanner = screen.getByTestId("hero-banner-with-data");
    const promotionsShowcase = screen.getByTestId("promotions-showcase");
    const businessShowcase = screen.getByTestId("business-showcase");
    const marketShowcase = screen.getByTestId("market-showcase");

    expect(heroBanner).toBeInTheDocument();
    expect(promotionsShowcase).toBeInTheDocument();
    expect(businessShowcase).toBeInTheDocument();
    expect(marketShowcase).toBeInTheDocument();
    expect(promotionsShowcase.compareDocumentPosition(businessShowcase)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(businessShowcase.compareDocumentPosition(marketShowcase)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "VerifyMzansi: Mzansi Market, Mzansi Business, Tourism and Events",
      })
    ).toHaveClass("sr-only");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    // The showroom is the first visible section, straight after the screen-reader h1.
    expect(screen.getByRole("main").children[1]).toBe(heroBanner);
    const categories = screen.getByRole("navigation", {
      name: "VerifyMzansi primary categories",
    });
    expect(heroBanner.compareDocumentPosition(categories)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(categories.compareDocumentPosition(promotionsShowcase)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    // Only the three areas are named; no invented sub-categories.
    expect(within(categories).getAllByRole("link")).toHaveLength(3);
  });

  it("uses canonical category href values", async () => {
    const ui = await HomePage();
    render(ui);

    const primaryCategories = screen.getByRole("navigation", {
      name: "VerifyMzansi primary categories",
    });

    expect(screen.getByRole("link", { name: /Post for Free/i })).toHaveAttribute(
      "href",
      "/post/create"
    );
    expect(screen.getByRole("link", { name: /Pricing/i })).toHaveAttribute("href", "/pricing");
    expect(within(primaryCategories).getByRole("link", { name: /Mzansi Market/i })).toHaveAttribute(
      "href",
      "/mzansi-market"
    );
    expect(
      within(primaryCategories).getByRole("link", { name: /Mzansi Business/i })
    ).toHaveAttribute("href", "/mzansi-business");
    expect(
      within(primaryCategories).getByRole("link", { name: /Tourism & Events/i })
    ).toHaveAttribute("href", "/tourism-events");
  });

  it("exposes the three public categories in search metadata and structured data", async () => {
    const ui = await HomePage();
    const { container } = render(ui);

    expect(metadata.title).toBe(
      "VerifyMzansi - Mzansi Market, Mzansi Business, Tourism and Events"
    );
    expect(metadata.description).toContain("Mzansi Market");
    expect(metadata.description).toContain("Mzansi Business");
    expect(metadata.description).toContain("Tourism and Events");

    const jsonLdScript = container.querySelector('script[type="application/ld+json"]');
    expect(jsonLdScript).not.toBeNull();

    const jsonLd = JSON.parse(jsonLdScript?.textContent ?? "{}") as {
      "@graph"?: Array<{
        "@type"?: string;
        hasPart?: Array<{ name?: string; description?: string; url?: string }>;
      }>;
    };
    const siteNavigation = jsonLd["@graph"]?.find(
      (entry) => entry["@type"] === "SiteNavigationElement"
    );

    expect(siteNavigation?.hasPart).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Mzansi Market",
          url: "https://verifymzansi.com/mzansi-market",
          description: expect.stringContaining("buying, selling, and browsing"),
        }),
        expect.objectContaining({
          name: "Mzansi Business",
          url: "https://verifymzansi.com/mzansi-business",
          description: expect.stringContaining("shops, trades, services"),
        }),
        expect.objectContaining({
          name: "Tourism and Events",
          url: "https://verifymzansi.com/tourism-events",
          description: expect.stringContaining("stays, destinations, venues"),
        }),
      ])
    );
  });

  it("links the post-for-free actions to the expected pages", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByRole("link", { name: /Post for Free/i })).toHaveAttribute(
      "href",
      "/post/create"
    );
    expect(screen.getByRole("link", { name: /Pricing/i })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: /Advertise/i })).toHaveAttribute("href", "/advertise");
    expect(screen.getByRole("heading", { name: "Your first post is free." })).toBeInTheDocument();
  });
});
