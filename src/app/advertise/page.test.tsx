import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENTERPRISE_PLANS, RETAIL_OFFERS } from "@/lib/constants/pricing";
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

vi.mock("@/components/brand", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  VerificationEmblem: () => null,
}));

const catalog = vi.hoisted(() => ({ retail: [] as unknown[], enterprise: [] as unknown[] }));
vi.mock("@/lib/commercial/plans", () => ({
  getCommercialCatalog: async () => ({ ...catalog, source: "database" }),
}));

describe("AdvertisePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalog.retail = RETAIL_OFFERS.map((offer) => ({ ...offer, planIds: {} }));
    catalog.enterprise = ENTERPRISE_PLANS.map((plan) => ({ ...plan, planId: null }));
  });

  it("explains the three ways to advertise with catalogue prices", async () => {
    render(await AdvertisePage());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Get seen by local buyers who know who they are dealing with/i,
      })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Post for free" })[0]).toHaveAttribute(
      "href",
      "/post/create"
    );
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
    expect(screen.getByText("From R50 / 30 days")).toBeInTheDocument();
    // Thousands use a non-breaking space (site-wide rand formatting).
    expect(screen.getByText(/^From R1\s200 \/ 90 days$/)).toBeInTheDocument();
    expect(screen.getByText(/^From R15\s000 \/ 90 days$/)).toBeInTheDocument();
    expect(
      screen.getByText(/R50 \/ 30 days · R140 \/ 90 days · R250 \/ 180 days/)
    ).toBeInTheDocument();
  });

  it("reads retail prices from the live catalogue rather than hard-coding them", async () => {
    catalog.retail = RETAIL_OFFERS.map((offer, index) => ({
      ...offer,
      priceCents: index === 0 ? 6000 : offer.priceCents,
      planIds: {},
    }));
    render(await AdvertisePage());
    expect(screen.getByText("From R60 / 30 days")).toBeInTheDocument();
  });

  it("anchors the programme partner section and makes no 12-month claims", async () => {
    const { container } = render(await AdvertisePage());

    expect(container.querySelector("#programmes")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Request a programme proposal" })).toHaveAttribute(
      "href",
      "/contact?topic=organisation_proposal"
    );
    expect(screen.getByText("Example — not real results")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/12 months|12-month|6 months|annual/i);
  });
});
