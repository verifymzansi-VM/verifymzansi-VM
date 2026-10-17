import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ENTERPRISE_PLANS } from "@/lib/constants/pricing";
import { MultiListingPlans, perPostPer30DaysCents } from "./multi-listing-plans";
import { MultiListingNudge } from "./multi-listing-nudge";

describe("MultiListingPlans", () => {
  const plans = ENTERPRISE_PLANS.map((plan, index) => ({ ...plan, planId: `plan-${index}` }));

  it("prices one live post per 30 days so plans compare with a single post", () => {
    expect(perPostPer30DaysCents({ priceCents: 120000, slots: 10, durationDays: 90 })).toBe(4000);
    expect(perPostPer30DaysCents({ priceCents: 215000, slots: 10, durationDays: 180 })).toBe(3583);
  });

  it("shows every size with a Choose button per term and the quote route", () => {
    render(<MultiListingPlans plans={plans} checkoutEnabled />);
    for (const slots of [10, 25, 50, 100])
      expect(screen.getByRole("heading", { name: `${slots} live posts` })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Choose 100 live posts for 180 days/ })
    ).toHaveAttribute("href", `/billing/checkout?plan=${plans[plans.length - 1]!.planId}`);
    expect(screen.getByText("R40 per post per 30 days")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a quote" })).toHaveAttribute(
      "href",
      "/contact?topic=organisation_proposal"
    );
  });

  it("falls back to a quote when no plans are loaded", () => {
    render(<MultiListingPlans plans={[]} checkoutEnabled />);
    expect(screen.getByRole("link", { name: "Ask us for a quote" })).toBeInTheDocument();
  });
});

describe("MultiListingNudge", () => {
  it("links the posting flow to the multi-listing page", () => {
    render(<MultiListingNudge emphasis="strong" />);
    expect(screen.getByText("Need more posts live at once?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See multi-listing plans/ })).toHaveAttribute(
      "href",
      "/pricing/multi-listing"
    );
  });
});
