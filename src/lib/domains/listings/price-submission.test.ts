import { describe, it, expect } from "vitest";
import { listingPriceModeFromRow, listingPriceSubmission } from "./price-form";

const form = (mode: "" | "amount" | "free" | "on_request", amount = "", negotiable = false) => ({
  mode,
  amount,
  negotiable,
});

describe("listingPriceSubmission", () => {
  it("sends an amount in rand with Negotiable", () => {
    expect(listingPriceSubmission("electronics", form("amount", "1500.50", true))).toEqual({
      price_zar: 1500.5,
      price_mode: "amount",
      negotiable: true,
    });
  });

  it("asks for a valid amount when Amount is chosen", () => {
    for (const amount of ["", "0", "-5", "1,500", "abc", "1.234"])
      expect(listingPriceSubmission("electronics", form("amount", amount))).toEqual({
        error: "Enter a valid price.",
      });
    expect(listingPriceSubmission("electronics", form(""))).toEqual({
      error: "Choose a price option.",
    });
  });

  it("sends Free without an amount and never Negotiable", () => {
    expect(listingPriceSubmission("home_lifestyle", form("free", "", true))).toEqual({
      price_zar: 0,
      price_mode: "free",
      negotiable: false,
    });
  });

  it("sends Price on request without an amount, keeping Negotiable", () => {
    expect(listingPriceSubmission("vehicles", form("on_request", "", true))).toEqual({
      price_zar: 0,
      price_mode: "on_request",
      negotiable: true,
    });
  });

  it("keeps the optional job salary: empty means not provided, never Negotiable", () => {
    expect(listingPriceSubmission("jobs_services", form("free", "", true))).toEqual({
      price_zar: 0,
      price_mode: "on_request",
      negotiable: false,
    });
    expect(listingPriceSubmission("jobs_services", form("amount", "12000", true))).toEqual({
      price_zar: 12000,
      price_mode: "amount",
      negotiable: false,
    });
    expect(listingPriceSubmission("jobs_services", form("amount", "abc"))).toEqual({
      error: "Enter a valid price.",
    });
  });
});

describe("listingPriceModeFromRow", () => {
  it("restores Free and Price on request; anything else is an amount", () => {
    expect(listingPriceModeFromRow({ price_mode: "free" })).toBe("free");
    expect(listingPriceModeFromRow({ price_mode: "on_request" })).toBe("on_request");
    expect(listingPriceModeFromRow({ price_mode: "amount" })).toBe("amount");
    expect(listingPriceModeFromRow({})).toBe("amount");
  });
});
