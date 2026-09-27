/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { BusinessPaymentDeliverySection } from "./business-payment-delivery-section";

describe("BusinessPaymentDeliverySection", () => {
  it("renders nothing when no payment methods and no delivery", () => {
    const { container } = render(
      <BusinessPaymentDeliverySection paymentMethods={null} deliveryAvailable={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for empty payment array and no delivery", () => {
    const { container } = render(
      <BusinessPaymentDeliverySection paymentMethods={[]} deliveryAvailable={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders payment methods when provided", () => {
    render(
      <BusinessPaymentDeliverySection
        paymentMethods={["cash", "credit_card", "eft"]}
        deliveryAvailable={false}
      />
    );
    expect(screen.getByText("Payment Methods")).toBeInTheDocument();
    expect(screen.getByText("cash")).toBeInTheDocument();
    expect(screen.getByText("credit card")).toBeInTheDocument();
    expect(screen.getByText("eft")).toBeInTheDocument();
  });

  it("renders delivery available badge", () => {
    render(<BusinessPaymentDeliverySection paymentMethods={null} deliveryAvailable={true} />);
    expect(screen.getByText("Delivery")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("renders both sections together", () => {
    render(<BusinessPaymentDeliverySection paymentMethods={["cash"]} deliveryAvailable={true} />);
    expect(screen.getByText("Payment Methods")).toBeInTheDocument();
    expect(screen.getByText("Delivery")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("cash")).toBeInTheDocument();
  });
});
