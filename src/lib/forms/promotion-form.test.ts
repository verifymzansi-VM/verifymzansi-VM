import { describe, expect, it } from "vitest";
import { validatePromotionForm } from "./promotion-form";

describe("promotion-form helpers", () => {
  it("rejects prices with more than two decimal places", () => {
    expect(
      validatePromotionForm({
        priceZar: "99.999",
        startDate: "",
        endDate: "",
        contactMethods: ["call"],
      })
    ).toEqual({
      price_zar: "Price can have at most 2 decimal places.",
    });
  });

  it("rejects an end date before the start date", () => {
    expect(
      validatePromotionForm({
        priceZar: "",
        startDate: "2026-03-20",
        endDate: "2026-03-19",
        contactMethods: ["call"],
      })
    ).toEqual({
      end_date: "End date must be on or after the start date.",
    });
  });
});
