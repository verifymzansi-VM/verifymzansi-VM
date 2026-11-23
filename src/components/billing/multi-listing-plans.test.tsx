import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MultiListingPlans, packageCheckoutHref } from "./multi-listing-plans";
import { MultiListingNudge } from "./multi-listing-nudge";
import type * as Pricing from "@/lib/constants/pricing";

// The nudge is tested with package sales switched off, the branch kept for
// turning them off again. It is on in production (owner's decision of 22 November 2026).
vi.mock("@/lib/constants/pricing", async (importOriginal) => ({
  ...(await importOriginal<typeof Pricing>()),
  PACKAGES_ON_SALE: false,
}));

describe("MultiListingPlans (P4a rules)", () => {
  it("shows the common sizes at R100 per slot per 30 days, each term going to the package checkout", () => {
    render(<MultiListingPlans />);
    for (const slots of [5, 10, 25, 50, 100])
      expect(screen.getByRole("heading", { name: `${slots} slots` })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Choose 5 slots for 30 days, R500/ })).toHaveAttribute(
      "href",
      "/billing/package?slots=5&days=30"
    );
    expect(
      screen.getByRole("link", { name: /Choose 25 slots for 90 days, R7\s500/ })
    ).toHaveAttribute("href", packageCheckoutHref(25, 90));
    expect(
      screen.getByRole("link", { name: /Choose 100 slots for 30 days, R10\s000/ })
    ).toBeInTheDocument();
    expect(screen.getByText(/R100 per slot per 30 days, from 5 slots/)).toBeInTheDocument();
  });

  it("offers totals above Ozow's maximum by invoice, never online", () => {
    render(<MultiListingPlans onlineMaxCents={1_000_000} />);
    expect(screen.queryByRole("link", { name: /Choose 50 slots for 90 days/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Choose 100 slots for 180 days/ })).toBeNull();
    expect(screen.getAllByText("By invoice").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Ask for an invoice" })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:billing@verifymzansi.com")
    );
  });

  it("drops the old rules: no 'paid once, never renews', no named administrators", () => {
    const { container } = render(<MultiListingPlans />);
    expect(container.textContent).not.toMatch(/never renews|administrators|Request a quote/);
    expect(container.textContent).toMatch(/does not renew automatically/);
  });
});

describe("MultiListingNudge", () => {
  it("shows nothing while multi-listing is not on sale", () => {
    const { container } = render(<MultiListingNudge emphasis="strong" />);
    expect(container).toBeEmptyDOMElement();
  });
});
