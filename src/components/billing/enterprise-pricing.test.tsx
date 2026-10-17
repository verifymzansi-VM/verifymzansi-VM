import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ENTERPRISE_PLANS } from "@/lib/constants/pricing";
import { EnterprisePricing } from "./enterprise-pricing";

describe("EnterprisePricing", () => {
  const plans = ENTERPRISE_PLANS.map((plan) => ({ ...plan, planId: null }));

  it("offers all three packages, each linking to its full details on the advertise page", () => {
    render(<EnterprisePricing plans={plans} checkoutEnabled retailFromCents={5000} />);

    expect(screen.getByText("From R50")).toBeInTheDocument();
    expect(screen.getByText(/^From R1\s200$/)).toBeInTheDocument();
    expect(screen.getByText(/^From R15\s000$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Full details of Individual/ })).toHaveAttribute(
      "href",
      "/advertise#individual"
    );
    expect(screen.getByRole("link", { name: /Full details of Multi-listing/ })).toHaveAttribute(
      "href",
      "/advertise#multi-listing"
    );
    expect(screen.getByRole("link", { name: /Full details of Business Sponsor/ })).toHaveAttribute(
      "href",
      "/advertise#programmes"
    );
  });

  it("shows the sponsor fee table on the pricing page", () => {
    const { container } = render(
      <EnterprisePricing plans={plans} checkoutEnabled retailFromCents={5000} />
    );

    expect(container.querySelector("#programme-prices")).not.toBeNull();
    expect(container.querySelector("#multi-listing-prices")).not.toBeNull();
    expect(screen.getByText("Sponsor fee (total for the term)")).toBeInTheDocument();
    expect(screen.getByText("Custom proposal")).toBeInTheDocument();
  });

  it("lets people choose a multi-listing plan straight to checkout", () => {
    const buyable = plans.map((plan, index) => ({ ...plan, planId: `plan-${index}` }));
    render(<EnterprisePricing plans={buyable} checkoutEnabled retailFromCents={5000} />);

    const choose = screen.getByRole("link", { name: /Choose 10 live posts for 90 days, R1\s200/ });
    expect(choose).toHaveAttribute("href", "/billing/checkout?plan=plan-0");
    expect(screen.getAllByRole("link", { name: /^Choose \d+ live posts/ })).toHaveLength(
      buyable.length
    );
    expect(screen.getByRole("link", { name: "Choose a multi-listing plan" })).toHaveAttribute(
      "href",
      "#multi-listing-prices"
    );
  });

  it("keeps prices visible without checkout links when online checkout is off", () => {
    render(<EnterprisePricing plans={plans} checkoutEnabled={false} retailFromCents={5000} />);
    expect(screen.queryAllByRole("link", { name: /^Choose \d+ live posts/ })).toHaveLength(0);
    expect(screen.getByText(/Online checkout for these plans is paused/)).toBeInTheDocument();
  });
});
