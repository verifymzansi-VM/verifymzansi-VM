import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RETAIL_OFFERS } from "@/lib/constants/pricing";
import AdvertisePage from "./page";
import type * as HiddenFeatures from "@/lib/hidden-features";
import type * as Pricing from "@/lib/constants/pricing";

// Package sales switched off too (see above).
vi.mock("@/lib/constants/pricing", async (importOriginal) => ({
  ...(await importOriginal<typeof Pricing>()),
  PACKAGES_ON_SALE: false,
}));

// These tests check Advertise with the sponsor offer and package sales
// switched off, the branch kept for turning them off again. Both are on in
// production (owner's decision of 22 November 2026); the
// launch-configuration and foundation browser tests check the page as served.
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  SHOW_SPONSOR_OFFER: false,
}));

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

const catalog = vi.hoisted(() => ({ retail: [] as unknown[] }));
vi.mock("@/lib/commercial/plans", () => ({
  getCommercialCatalog: async () => ({ ...catalog, source: "database", onSale: false }),
}));

describe("AdvertisePage", () => {
  beforeEach(() => {
    catalog.retail = RETAIL_OFFERS.map((offer) => ({ ...offer, planIds: {} }));
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

  it("states the live edit allowance (over the post's life, by slot length)", async () => {
    const { container } = render(await AdvertisePage());

    expect(
      screen.getByText(
        "Each live post: up to 2, 6 or 12 approved edits for a 30-, 90- or 180-day slot"
      )
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Up to 2 approved edits|for every 30 days/);
  });

  it("offers 1 to 4 Individual slots and makes no 'people can trust' claim", async () => {
    const { container } = render(await AdvertisePage());
    const text = container.textContent ?? "";

    expect(text).toMatch(/you can hold 1 to 4 slots at a time/);
    expect(text).toMatch(/1 to 4 live slots at a time/);
    expect(screen.getByText("Individual slots (price per slot)")).toBeInTheDocument();
    expect(text).not.toMatch(/people can trust|One live slot|1 live slot in/);
  });

  it("answers 'Can I cancel?' as the Terms' Paying and Refunds & cancelling sections do", async () => {
    const { container } = render(await AdvertisePage());
    const text = container.textContent ?? "";

    expect(screen.getByText("Can I cancel?")).toBeInTheDocument();
    for (const rule of [
      "so the 7-day cooling-off does not apply and a change of mind is not a reason for a refund",
      "A rejected post keeps its slot: correct it and submit it again.",
      "If we wrongly reject a post, a paid slot does not work, or the site is down for more than 24 hours in a row, we first add the days you lost; if you still ask, we refund a reasonable part of the price for those days.",
      "If you are an individual (sole traders included), you can cancel a slot by emailing billing@verifymzansi.com from your account's email address.",
      "The slot runs for 20 more business days, then we credit its unused whole days, less a R50 fee; if that is R0 or less, nothing is paid, so cancelling a 30-day slot usually returns nothing.",
      "Closing your account cancels all your slots.",
      "Companies and other organisations are not refunded for unused days.",
      "Billing errors and duplicate payments are refunded in full once we have checked them.",
      "Refunds go to the account that paid, within 30 days after we approve them.",
      "Your rights under the Consumer Protection Act are not affected.",
    ])
      expect(text).toContain(rule);
    expect(screen.getByRole("link", { name: "Refunds & cancelling in the Terms" })).toHaveAttribute(
      "href",
      "/terms#refunds"
    );
    expect(text).not.toMatch(/Unused days are not refunded|We refund rejected posts/);
    expect(text).not.toMatch(/statutory cooling-off rights apply|is not refunded either/);
  });

  it("offers no paid add-ons (removed, item 37)", async () => {
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
    expect(screen.getByText("Individual slots (price per slot)")).toBeInTheDocument();
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
