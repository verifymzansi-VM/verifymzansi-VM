import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnterprisePricing } from "./enterprise-pricing";

describe("EnterprisePricing", () => {
  it("offers Individual and Multi-listing, each linking to its full details on the advertise page", () => {
    render(<EnterprisePricing checkoutEnabled retailFromCents={5000} />);

    expect(screen.getByText("From R50")).toBeInTheDocument();
    // The package rules (P4a): from 5 slots at R100 per slot per 30 days.
    expect(screen.getByText(/^From R500$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Full details of Individual/ })).toHaveAttribute(
      "href",
      "/advertise#individual"
    );
    expect(screen.getByRole("link", { name: /Full details of Multi-listing/ })).toHaveAttribute(
      "href",
      "/advertise#multi-listing"
    );
    // The sponsor offer is on hold (src/lib/hidden-features.ts).
    expect(screen.queryByRole("link", { name: /Full details of Business Sponsor/ })).toBeNull();
  });

  it("shows the multi-listing prices and no sponsor fee table while the sponsor offer is on hold", () => {
    const { container } = render(<EnterprisePricing checkoutEnabled retailFromCents={5000} />);

    expect(container.querySelector("#programme-prices")).toBeNull();
    expect(container.querySelector("#multi-listing-prices")).not.toBeNull();
    expect(screen.queryByText("Sponsor fee (total for the term)")).toBeNull();
    expect(screen.queryByRole("link", { name: "Request a sponsor proposal" })).toBeNull();
  });

  it("lets people choose a multi-listing package straight to the package checkout", () => {
    render(<EnterprisePricing checkoutEnabled retailFromCents={5000} />);

    const choose = screen.getByRole("link", { name: /Choose 10 slots for 90 days, R3\s000/ });
    expect(choose).toHaveAttribute("href", "/billing/package?slots=10&days=90");
    expect(screen.getByRole("link", { name: "Choose a multi-listing plan" })).toHaveAttribute(
      "href",
      "#multi-listing-prices"
    );
  });
});
