import { describe, expect, it } from "vitest";
import {
  hasBusinessDeliveryAvailable,
  sanitizeBusinessDetailsForSubmission,
} from "./business-type-details";

describe("business-type-details helpers", () => {
  it("keeps online-only delivery regions when delivery is available", () => {
    expect(
      sanitizeBusinessDetailsForSubmission(
        {
          type: "online_only",
          primary_order_channel: "website",
          order_url: "https://orders.example.com",
          delivery_regions: [" Johannesburg ", "Pretoria"],
          support_response_time: "Within 2 hours",
        },
        true
      )
    ).toEqual({
      type: "online_only",
      primary_order_channel: "website",
      order_url: "https://orders.example.com",
      delivery_regions: ["Johannesburg", "Pretoria"],
      support_response_time: "Within 2 hours",
    });
  });

  it("removes stale online-only delivery regions when delivery is disabled", () => {
    expect(
      sanitizeBusinessDetailsForSubmission(
        {
          type: "online_only",
          primary_order_channel: "website",
          order_url: "https://orders.example.com",
          delivery_regions: ["Johannesburg"],
          support_response_time: "Within 2 hours",
        },
        false
      )
    ).toEqual({
      type: "online_only",
      primary_order_channel: "website",
      order_url: "https://orders.example.com",
      support_response_time: "Within 2 hours",
    });
  });

  it("treats legacy online-only delivery regions as delivery enabled", () => {
    expect(
      hasBusinessDeliveryAvailable([], {
        type: "online_only",
        primary_order_channel: "website",
        order_url: "https://orders.example.com",
        delivery_regions: ["Nationwide"],
        support_response_time: "Within 2 hours",
      })
    ).toBe(true);
  });
});
