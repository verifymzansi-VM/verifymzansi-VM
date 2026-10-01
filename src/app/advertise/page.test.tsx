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
    catalog.retail = RETAIL_OFFERS.map((offer) => ({ ...offer, planIds: {} }));
    catalog.enterprise = ENTERPRISE_PLANS.map((plan) => ({ ...plan, planId: null }));
  });

  it("explains the three packages and links each to its full details", async () => {
    const { container } = render(await AdvertisePage());

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

    for (const [name, id] of [
      ["Individual", "individual"],
      ["Multi-listing", "multi-listing"],
      ["Programme partner", "programmes"],
    ] as const) {
      expect(screen.getByRole("link", { name: `Full details of ${name}` })).toHaveAttribute(
        "href",
        `#${id}`
      );
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(screen.getAllByText("Who can use it")).toHaveLength(3);
  });

  it("shows a price sheet for each package and links to the full pricing page", async () => {
    const { container } = render(await AdvertisePage());

    expect(screen.getByRole("link", { name: "See individual prices" })).toHaveAttribute(
      "href",
      "/pricing#plans"
    );
    expect(screen.getByRole("link", { name: "See multi-listing prices" })).toHaveAttribute(
      "href",
      "/pricing#multi-listing-prices"
    );
    expect(screen.getByRole("link", { name: "See programme fees" })).toHaveAttribute(
      "href",
      "/pricing#programme-prices"
    );
    expect(screen.getByText("Individual plans (one live slot)")).toBeInTheDocument();
    expect(screen.getByText("Multi-listing price (total for the term)")).toBeInTheDocument();
    expect(screen.getByText("Programme fee (total for the term)")).toBeInTheDocument();
    expect(container.textContent).toMatch(/R50/);
    expect(container.textContent).toMatch(/R1\s200/);
    expect(container.textContent).toMatch(/R15\s000/);
  });

  it("keeps the programme partner proposal link and makes no 12-month claims", async () => {
    const { container } = render(await AdvertisePage());

    expect(screen.getByRole("link", { name: "Request a programme proposal" })).toHaveAttribute(
      "href",
      "/contact?topic=organisation_proposal"
    );
    expect(screen.getByText("Example — not real results")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/12 months|12-month|6 months|annual/i);
  });
});
