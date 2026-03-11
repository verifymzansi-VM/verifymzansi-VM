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

  it("renders the current showcase sections and onboarding guide", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByTestId("hero-banner-with-data")).toBeInTheDocument();
    expect(screen.getByTestId("market-showcase")).toBeInTheDocument();
    expect(screen.getByTestId("business-showcase")).toBeInTheDocument();
    expect(screen.getByTestId("promotions-showcase")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Start here on VerifyMzansi" })
    ).toBeInTheDocument();
    expect(screen.getByText("New to VerifyMzansi?")).toBeInTheDocument();
    expect(screen.getByText("Create an account")).toBeInTheDocument();
    expect(screen.getByText("Complete verification")).toBeInTheDocument();
    expect(screen.getByText("Browse or post in the area that fits your goal")).toBeInTheDocument();
  });

  it("uses canonical category href values", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByRole("link", { name: /Create your account/i })).toHaveAttribute(
      "href",
      "/register"
    );
    expect(screen.getByRole("link", { name: /See pricing and plans/i })).toHaveAttribute(
      "href",
      "/pricing"
    );
    expect(
      screen.getByRole("link", {
        name: /Mzansi Market Browse or post verified listings for everyday buying and selling\./i,
      })
    ).toHaveAttribute("href", "/mzansi-market");
    expect(
      screen.getByRole("link", {
        name: /Mzansi Business Find trusted businesses or create a profile for your services\./i,
      })
    ).toHaveAttribute("href", "/mzansi-business");
    expect(
      screen.getByRole("link", {
        name: /Promotions & Events Discover current offers and events or advertise a new campaign\./i,
      })
    ).toHaveAttribute("href", "/promotions");
  });

  it("links onboarding destinations and actions to the expected pages", async () => {
    const ui = await HomePage();
    render(ui);

    expect(screen.getByRole("link", { name: /Create your account/i })).toHaveAttribute(
      "href",
      "/register"
    );
    expect(screen.getByRole("link", { name: /See pricing and plans/i })).toHaveAttribute(
      "href",
      "/pricing"
    );
    expect(screen.getByText("Create an account")).toBeInTheDocument();
    expect(screen.getByText("Complete verification")).toBeInTheDocument();
    expect(screen.getByText("Browse or post in the area that fits your goal")).toBeInTheDocument();
  });
});
