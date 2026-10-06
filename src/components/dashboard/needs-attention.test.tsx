import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NeedsAttention } from "./needs-attention";

const base = {
  unreadLeadCount: 0,
  rejectedListingCount: 0,
  pendingModerationCount: 0,
  expiringListingCount: 0,
  expiringPromoCount: 0,
  verificationStatus: "verified" as const,
  stepsRemaining: 0,
};

describe("NeedsAttention", () => {
  it("renders nothing when there is nothing to do", () => {
    const { container } = render(<NeedsAttention {...base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("points owners of businesses without stickers to verification", () => {
    render(<NeedsAttention {...base} unstickeredBusinessCount={1} />);
    expect(screen.getByRole("link", { name: /Verify your business/ })).toHaveAttribute(
      "href",
      "/dashboard/listings?area=MZANSI_BUSINESS"
    );
  });

  it("counts several businesses", () => {
    render(<NeedsAttention {...base} unstickeredBusinessCount={3} />);
    expect(screen.getByText("Verify 3 businesses")).toBeInTheDocument();
  });
});
