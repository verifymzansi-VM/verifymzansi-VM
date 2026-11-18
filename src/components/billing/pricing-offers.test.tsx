import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatPlanPrice, RETAIL_OFFERS } from "@/lib/constants/pricing";
import type { MarketplaceArea } from "@/types/enums";
import { PricingOffers } from "./pricing-offers";
import type { RetailPricingOffer } from "./retail-pricing";

// The foundation catalogue gives every section the same Individual slot plan
// (src/lib/commercial/plans.ts), as the seeded plan ids below.
const PLAN_IDS: Record<number, string> = {
  30: "d6ca48e5-43be-40df-8d8c-72c98a6fda96",
  90: "6a449457-2384-457e-9434-23c2b0e73127",
  180: "ce4ef578-344a-4816-ab6a-6961bec46621",
};

const offers: RetailPricingOffer[] = RETAIL_OFFERS.map((offer) => {
  const id = PLAN_IDS[offer.durationDays]!;
  return {
    ...offer,
    planIds: { MZANSI_MARKET: id, MZANSI_BUSINESS: id, PROMOTIONS_EVENTS: id } as Record<
      MarketplaceArea,
      string
    >,
  };
});

describe("PricingOffers", () => {
  it("shows Individual slots without a tab row while only they are on sale", () => {
    const { container } = render(<PricingOffers offers={offers} onSale showMultiListing={false} />);

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    // What a slot includes, said once rather than on every card.
    for (const text of [
      "1 live post at a time",
      "10 photos and 1 video",
      "Up to 4 posts per 30 days",
      "Market, Business or Tourism",
      "Hold up to 4 slots at a time.",
    ])
      expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Where will you post|Need 5 or more|sponsor/i);
    expect(container.textContent).not.toMatch(/R100|Multi-listing/);
  });

  it("links each term to the section-free Individual slot checkout and highlights 30 days", () => {
    render(<PricingOffers offers={offers} onSale showMultiListing={false} />);

    for (const [tier, days, price] of [
      ["month", 30, "R69"],
      ["quarter", 90, "R207"],
      ["half_year", 180, "R414"],
    ] as const) {
      const card = screen.getByTestId(`retail-offer-${tier}`);
      expect(within(card).getByTestId("retail-offer-price")).toHaveTextContent(price);
      expect(within(card).getByRole("link", { name: `Choose ${days} days` })).toHaveAttribute(
        "href",
        `/billing/checkout?plan=${PLAN_IDS[days]}`
      );
    }
    expect(within(screen.getByTestId("retail-offer-month")).getByText("Paid once")).toBeVisible();
    expect(
      within(screen.getByTestId("retail-offer-quarter")).getByText("R69 per 30 days")
    ).toBeVisible();
    // The 30-day card is the highlighted one (filled button).
    expect(within(screen.getByTestId("retail-offer-month")).getByRole("link").className).toMatch(
      /bg-brand-green-600/
    );
    expect(
      within(screen.getByTestId("retail-offer-quarter")).getByRole("link").className
    ).not.toMatch(/bg-brand-green-600/);
  });

  it("offers free events below the slots", () => {
    render(<PricingOffers offers={offers} onSale showMultiListing={false} />);
    const events = screen.getByTestId("free-events");
    expect(within(events).getByText("Events are free")).toBeInTheDocument();
    expect(within(events).getByRole("link", { name: "Post an event" })).toHaveAttribute(
      "href",
      "/post/create-tourism?type=event"
    );
  });

  it("shows prices without a way to buy while paid slots are off sale", () => {
    render(<PricingOffers offers={offers} onSale={false} showMultiListing={false} />);
    expect(screen.getAllByRole("button", { name: "Opens soon" })).toHaveLength(3);
    expect(screen.queryByRole("link", { name: /^Choose / })).toBeNull();
    expect(screen.getByText(/Paid slots open soon/)).toBeInTheDocument();
  });

  it("adds a Multi-listing tab while packages are on sale", () => {
    render(<PricingOffers offers={offers} onSale showMultiListing />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Individual", "Multi-listing"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[0]!.id);

    fireEvent.click(screen.getByRole("tab", { name: "Multi-listing" }));
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("5 to 250 slots, 1 live post each");
    expect(panel).toHaveTextContent("Up to 4 posts go live per slot per 30 days");
    expect(panel).toHaveTextContent("ID review first. One package per account");
    expect(panel).toHaveTextContent("R100per slot per 30 days");
    // Rand amounts use the site format, with a no-break space ("R1 000").
    expect(panel.textContent).toContain(
      `Example: 10 slots for 30 days = ${formatPlanPrice(100_000)}`
    );
    expect(within(panel).getByRole("link", { name: "Choose your package" })).toHaveAttribute(
      "href",
      "/pricing/multi-listing"
    );
    // Parts of packages that are not built are never offered.
    expect(panel.textContent).not.toMatch(/team|invoice|renew all|add slots/i);
    // Free events stay below either offer.
    expect(screen.getByTestId("free-events")).toBeInTheDocument();
  });

  it("opens the Multi-listing tab from 'Need 5 or more?' and moves with the arrow keys", () => {
    render(<PricingOffers offers={offers} onSale showMultiListing />);

    fireEvent.click(screen.getByRole("button", { name: "Need 5 or more?" }));
    expect(screen.getByRole("tab", { name: "Multi-listing" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "Multi-listing" }), { key: "ArrowRight" });
    const individual = screen.getByRole("tab", { name: "Individual" });
    expect(individual).toHaveAttribute("aria-selected", "true");
    expect(individual).toHaveFocus();
    expect(screen.getByTestId("retail-offer-month")).toBeInTheDocument();
  });
});
