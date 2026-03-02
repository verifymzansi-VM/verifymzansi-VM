import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./page";
import { createClient } from "@supabase/supabase-js";

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

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="footer" />,
}));

vi.mock("@/components/home/hero-banner", () => ({
  HeroBanner: () => <div data-testid="hero-banner" />,
}));

vi.mock("@/components/home/home-mall-shops-showcase", () => ({
  HomeMallShopsShowcase: () => <div data-testid="mall-showcase" />,
}));

vi.mock("@/components/home/home-business-ads-showcase", () => ({
  HomeBusinessAdsShowcase: () => <div data-testid="business-showcase" />,
}));

vi.mock("@/components/home/home-mzansi-market-showcase", () => ({
  HomeMzansiMarketShowcase: () => <div data-testid="market-showcase" />,
}));

function createSupabaseMock() {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [] }),
    })),
  };
}

describe("HomePage category links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses canonical category href values", async () => {
    vi.mocked(createClient).mockReturnValue(createSupabaseMock() as never);

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
  });
});
