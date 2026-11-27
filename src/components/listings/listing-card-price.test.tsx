/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingCard } from "./listing-card";
import { describeListingPrice } from "@/lib/presentation/listing-facts";

const card = {
  id: "listing-1",
  title: "Old couch",
  province: "Gauteng",
  city: "Johannesburg",
  category: "home_lifestyle",
  createdAt: "2026-11-27T08:00:00.000Z",
};

describe("listing price display", () => {
  it("card stays quiet for Price on request: never R0, Free or Neg", () => {
    render(<ListingCard {...card} price={0} priceMode="on_request" negotiable />);
    expect(screen.queryByText(/R\s?0\b/)).not.toBeInTheDocument();
    expect(screen.queryByText("Free")).not.toBeInTheDocument();
    expect(screen.queryByText(/Neg/)).not.toBeInTheDocument();
  });

  it("card shows Free for a free item, without Negotiable", () => {
    render(<ListingCard {...card} price={0} priceMode="free" negotiable />);
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.queryByText(/Neg/)).not.toBeInTheDocument();
  });

  it("card shows the amount for a priced item", () => {
    render(<ListingCard {...card} price={150000} priceMode="amount" />);
    expect(screen.getByText(/R\s?1[\s,]?500/)).toBeInTheDocument();
  });

  it("post page words: Price on request without an amount, Free for a free item", () => {
    for (const cents of [null, 0])
      expect(
        describeListingPrice({ category: "vehicles", price_cents: cents, price_mode: "on_request" })
      ).toEqual({ kind: "none", label: "Price on request" });
    expect(
      describeListingPrice({ category: "vehicles", price_cents: 0, price_mode: "free" })
    ).toEqual({ kind: "free", label: "Free" });
  });
});
