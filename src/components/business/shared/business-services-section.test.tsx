/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { BusinessServicesSection } from "./business-services-section";

describe("BusinessServicesSection", () => {
  it("renders nothing for empty services array", () => {
    const { container } = render(<BusinessServicesSection services={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders services as badges", () => {
    render(<BusinessServicesSection services={["Haircuts", "Manicure", "Waxing"]} />);
    expect(screen.getByText("Haircuts")).toBeInTheDocument();
    expect(screen.getByText("Manicure")).toBeInTheDocument();
    expect(screen.getByText("Waxing")).toBeInTheDocument();
  });

  it("uses default heading", () => {
    render(<BusinessServicesSection services={["Repairs"]} />);
    expect(screen.getByText("Services Offered")).toBeInTheDocument();
  });

  it("uses custom heading", () => {
    render(<BusinessServicesSection services={["Pizza"]} heading="Our Menu" />);
    expect(screen.getByText("Our Menu")).toBeInTheDocument();
  });

  it("renders inline (no card) when asCard is false", () => {
    const { container } = render(
      <BusinessServicesSection services={["Plumbing"]} asCard={false} />
    );
    expect(screen.getByText("Plumbing")).toBeInTheDocument();
    // No heading rendered in inline mode
    expect(screen.queryByText("Services Offered")).not.toBeInTheDocument();
    // The wrapper is a simple div, not a Card
    expect(container.querySelector("[data-slot='card']")).toBeNull();
  });
});
