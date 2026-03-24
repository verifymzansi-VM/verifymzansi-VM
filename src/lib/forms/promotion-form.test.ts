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
        socialAuthorization: { granted: false },
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
        socialAuthorization: { granted: false },
      })
    ).toEqual({
      end_date: "End date must be on or after the start date.",
    });
  });

  it("requires all social authorization fields when external posting is authorized", () => {
    expect(
      validatePromotionForm({
        priceZar: "",
        startDate: "",
        endDate: "",
        contactMethods: ["call"],
        socialAuthorization: {
          granted: true,
          authorizerName: "",
          authorizerRole: "",
          monetizationAcknowledged: false,
          acceptedVersion: "",
        },
      })
    ).toEqual({
      "socialAuthorization.authorizerName": "Enter the authorizer's full name.",
      "socialAuthorization.authorizerRole": "Enter the authorizer's role or title.",
      "socialAuthorization.relationship": "Select the authorizer relationship.",
      "socialAuthorization.monetizationAcknowledged":
        "You must acknowledge the monetization policy.",
      "socialAuthorization.acceptedVersion": "You must accept the current authorization terms.",
    });
  });
});
