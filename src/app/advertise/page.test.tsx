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
  getCommercialCatalog: async () => ({ ...catalog, source: "database", onSale: false }),
}));

describe("AdvertisePage", () => {
  beforeEach(() => {
    catalog.retail = RETAIL_OFFERS.map((offer) => ({ ...offer, planIds: {} }));
    catalog.enterprise = ENTERPRISE_PLANS.map((plan) => ({ ...plan, planId: null }));
  });

  it("explains the Individual package only, with no chooser for a single choice", async () => {
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

    expect(container.querySelector("#individual")).not.toBeNull();
    // Multi-listing is hidden while it is not on sale; the sponsor programme is on hold.
    expect(container.querySelector("#multi-listing")).toBeNull();
    expect(container.querySelector("#programmes")).toBeNull();
    // With one package left there is nothing to choose between.
    expect(container.querySelector("#packages")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Full details of/ })).toBeNull();
    expect(screen.getAllByText("Who can use it")).toHaveLength(1);
  });

  it("states the live edit allowance, not 2 edits in total", async () => {
    const { container } = render(await AdvertisePage());

    expect(
      screen.getByText(
        "2 approved edits per live post for every 30 days of its slot (30 days: 2, 90 days: 6, 180 days: 12)"
      )
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Up to 2 approved edits/);
  });

  it("answers 'Can I cancel?' as the Terms' Refunds & cancelling section does", async () => {
    const { container } = render(await AdvertisePage());
    const text = container.textContent ?? "";

    expect(screen.getByText("Can I cancel?")).toBeInTheDocument();
    expect(text).toMatch(/A change of mind is not a reason for a refund/);
    expect(text).toMatch(/so the 7-day cooling-off does not apply/);
    expect(text).toMatch(/A rejected post is not refunded either; the slot stays yours/);
    expect(text).toMatch(
      /If you are an individual, you can cancel a slot by writing to billing@verifymzansi\.com: it runs for 20 business days more, then we credit its unused whole days, less a R50 fee/
    );
    expect(text).toMatch(/Companies and other organisations are not refunded for unused days/);
    expect(text).toMatch(/Billing errors and duplicate payments are refunded in full/);
    expect(text).not.toMatch(/Unused days are not refunded|We refund rejected posts/);
    expect(text).not.toMatch(/statutory cooling-off rights apply/);
  });

  it("offers no paid add-ons while they do not deliver", async () => {
    const { container } = render(await AdvertisePage());

    expect(screen.queryByRole("heading", { name: "Get more eyes on a post" })).toBeNull();
    expect(container.textContent).not.toMatch(/Urgent|Boost|Featured/);
  });

  it("shows a price sheet for each package and links to the full pricing page", async () => {
    const { container } = render(await AdvertisePage());

    expect(screen.getByRole("link", { name: "See individual prices" })).toHaveAttribute(
      "href",
      "/pricing#plans"
    );
    expect(screen.queryByRole("link", { name: "See multi-listing prices" })).toBeNull();
    expect(screen.queryByRole("link", { name: "See sponsor fees" })).toBeNull();
    expect(screen.getByText("Individual plans (one live slot)")).toBeInTheDocument();
    expect(screen.queryByText("Multi-listing price (total for the term)")).toBeNull();
    expect(screen.queryByText("By written proposal")).toBeNull();
    expect(container.textContent).toMatch(/R69/);
    expect(container.textContent).toMatch(/Paid slots open soon/);
    expect(container.textContent).not.toMatch(
      /R1\s200|R15\s000|from R50|R50 for|R140|R250|while launch/
    );
  });

  it("hides the sponsor offer while the programme is on hold and sells no multi-listing", async () => {
    const { container } = render(await AdvertisePage());

    expect(screen.queryByRole("link", { name: "Request a sponsor proposal" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Talk to us about sponsoring/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Choose a multi-listing plan" })).toBeNull();
    expect(screen.queryByText("Example — not real results")).toBeNull();
    expect(screen.queryByText("Founding pilots")).toBeNull();
    expect(container.textContent).not.toMatch(/Business Sponsor|Supported by|B-BBEE|sponsor/i);
    expect(container.textContent).not.toMatch(/12 months|12-month|6 months|annual/i);
  });
});
