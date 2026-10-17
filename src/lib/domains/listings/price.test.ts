import { describe, it, expect } from "vitest";
import {
  storeListingPrice,
  readListingPrice,
  listingPricePresentation,
  MAX_LISTING_PRICE_CENTS,
} from "./price";

describe("foundation listing price modes", () => {
  it.each([
    { mode: "amount", amount_cents: 1 },
    { mode: "amount", amount_cents: MAX_LISTING_PRICE_CENTS },
    { mode: "free" },
    { mode: "on_request" },
  ])("preserves explicit price state through storage and read: %j", (price) => {
    expect(readListingPrice(storeListingPrice(price, "electronics"), "electronics")).toEqual(price);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, MAX_LISTING_PRICE_CENTS + 1])(
    "rejects invalid amount cents %s",
    (amount_cents) => {
      expect(() => storeListingPrice({ mode: "amount", amount_cents }, "electronics")).toThrow();
    }
  );
  it.each([
    { mode: "free", amount_cents: 100 },
    { mode: "on_request", amount_cents: 0 },
    { mode: "amount" },
    { mode: "zero" },
    { price_zar: 0 },
  ])("rejects ambiguous or hidden input %j", (price) => {
    expect(() => storeListingPrice(price, "electronics")).toThrow();
  });
  it.each([
    { price_mode: "free", price_cents: 1 },
    { price_mode: "free", price_cents: null },
    { price_mode: "on_request", price_cents: 0 },
    { price_mode: "amount", price_cents: 0 },
    { price_mode: "amount", price_cents: null },
  ])("rejects contradictory stored projection %j", (price) => {
    expect(() => readListingPrice(price, "electronics")).toThrow();
  });
  it("keeps Free, request and undisclosed salary display distinct", () => {
    expect(listingPricePresentation({ mode: "free" }, "electronics")).toEqual({
      kind: "label",
      label: "Free",
    });
    expect(listingPricePresentation({ mode: "on_request" }, "electronics")).toEqual({
      kind: "label",
      label: "Price on request",
    });
    expect(listingPricePresentation({ mode: "on_request" }, "jobs_services")).toEqual({
      kind: "label",
      label: "Salary not provided",
    });
    expect(() => storeListingPrice({ mode: "free" }, "jobs_services")).toThrow();
    expect(() =>
      readListingPrice({ price_mode: "free", price_cents: 0 }, "jobs_services")
    ).toThrow();
  });
});
