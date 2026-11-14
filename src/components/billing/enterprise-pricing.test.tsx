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

  it("lets people choose a multi-listing package straight to the package checkout", () => {
    render(<EnterprisePricing plans={plans} checkoutEnabled retailFromCents={5000} />);

    const choose = screen.getByRole("link", { name: /Choose 10 slots for 90 days, R3\s000/ });
    expect(choose).toHaveAttribute("href", "/billing/package?slots=10&days=90");
    expect(screen.getByRole("link", { name: "Choose a multi-listing plan" })).toHaveAttribute(
      "href",
      "#multi-listing-prices"
    );
  });
});
