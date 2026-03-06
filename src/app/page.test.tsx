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

  it("renders the current showcase sections", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByTestId("hero-banner-with-data")).toBeInTheDocument();
    expect(screen.getByTestId("market-showcase")).toBeInTheDocument();
    expect(screen.getByTestId("business-showcase")).toBeInTheDocument();
    expect(screen.getByTestId("promotions-showcase")).toBeInTheDocument();
  });

  it("uses canonical category href values", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByRole("link", { name: "Vehicles" })).toHaveAttribute(
      "href",
      "/mzansi-market?category=vehicles"
    );
    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute(
      "href",
      "/mzansi-market?category=jobs_services"
    );
    expect(screen.getByRole("link", { name: "Business" })).toHaveAttribute(
      "href",
      "/mzansi-business"
    );
  });
});
