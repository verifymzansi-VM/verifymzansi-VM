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
    expect(screen.getByRole("link", { name: /Full details of Programme partner/ })).toHaveAttribute(
      "href",
      "/advertise#programmes"
    );
  });

  it("shows the programme fee table on the pricing page", () => {
    const { container } = render(
      <EnterprisePricing plans={plans} checkoutEnabled retailFromCents={5000} />
    );

    expect(container.querySelector("#programme-prices")).not.toBeNull();
    expect(container.querySelector("#multi-listing-prices")).not.toBeNull();
    expect(screen.getByText("Programme fee (total for the term)")).toBeInTheDocument();
    expect(screen.getByText("Custom proposal")).toBeInTheDocument();
  });
});
