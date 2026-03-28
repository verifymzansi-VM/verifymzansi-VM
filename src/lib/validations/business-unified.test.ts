import { describe, expect, it } from "vitest";
import { businessSchema } from "./business-unified";

const base = {
  business_name: "Nomsa Fashion",
  slug: "nomsa-fashion",
  category: "fashion_accessories",
  description: "A valid business profile description.",
  location_province: "Gauteng",
  location_city: "Johannesburg",
};

describe("businessSchema", () => {
  it("accepts mall stores with richer mall details", () => {
    expect(
      businessSchema.safeParse({
        ...base,
        business_type: "mall_store",
        store_number: "12A",
        business_details: {
          type: "mall_store",
          mall_name: "Maponya Mall",
          mall_address: "2127 Chris Hani Rd, Soweto",
          mall_summary: "Near the cinema entrance.",
          mall_photos: ["https://media.verifymzansi.com/business/mall-photo-1.jpg"],
          floor_or_wing: "Upper level",
          nearest_entrance: "Entrance 3",
          parking_notes: "Park near Woolworths.",
        },
      }).success
    ).toBe(true);
  });

  it("requires mall_name for mall stores", () => {
    const result = businessSchema.safeParse({
      ...base,
      business_type: "mall_store",
      store_number: "12A",
      business_details: {
        type: "mall_store",
        mall_name: "",
      },
    });

    expect(result.success).toBe(false);
  });

  it("requires address details for standalone shops", () => {
    const result = businessSchema.safeParse({
      ...base,
      business_type: "standalone_shop",
      business_details: {
        type: "standalone_shop",
        street_address: "",
        suburb: "",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.path.join("."));
      expect(messages).toContain("business_details.street_address");
      expect(messages).toContain("business_details.suburb");
    }
  });

  it("requires a service suburb for home businesses", () => {
    expect(
      businessSchema.safeParse({
        ...base,
        business_type: "home_business",
        business_details: {
          type: "home_business",
          service_suburb: "Noordwyk",
          appointment_required: true,
          customer_pickup_allowed: false,
          visitor_notes: "Visits by prior arrangement only.",
        },
      }).success
    ).toBe(true);
  });

  it("requires service areas for mobile services", () => {
    const result = businessSchema.safeParse({
      ...base,
      business_type: "mobile_service",
      business_details: {
        type: "mobile_service",
        emergency_callouts: true,
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "service_areas")).toBe(
        true
      );
    }
  });

  it("accepts online-only businesses without delivery region details", () => {
    expect(
      businessSchema.safeParse({
        ...base,
        business_type: "online_only",
        business_details: {
          type: "online_only",
          primary_order_channel: "website",
          order_url: "https://orders.example.com",
          support_response_time: "Within 2 hours",
        },
        delivery_options: ["delivery"],
      }).success
    ).toBe(true);
  });

  it("accepts online-only businesses with optional delivery region details", () => {
    expect(
      businessSchema.safeParse({
        ...base,
        business_type: "online_only",
        business_details: {
          type: "online_only",
          primary_order_channel: "website",
          order_url: "https://orders.example.com",
          delivery_regions: ["Johannesburg", "Pretoria"],
          support_response_time: "Within 2 hours",
        },
        delivery_options: ["delivery"],
      }).success
    ).toBe(true);
  });

  it("requires market schedule details for market stalls", () => {
    expect(
      businessSchema.safeParse({
        ...base,
        business_type: "market_stall",
        business_details: {
          type: "market_stall",
          market_name: "Neighbourgoods Market",
          stall_label: "A12",
          trading_days: ["Saturday", "Sunday"],
          trading_hours: "09:00 - 16:00",
        },
      }).success
    ).toBe(true);
  });

  it("rejects mismatched business_details type", () => {
    const result = businessSchema.safeParse({
      ...base,
      business_type: "online_only",
      business_details: {
        type: "market_stall",
        market_name: "Neighbourgoods Market",
        trading_days: ["Saturday"],
        trading_hours: "09:00 - 16:00",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects business media hosted outside the platform", () => {
    const result = businessSchema.safeParse({
      ...base,
      business_type: "standalone_shop",
      logo_url: "https://evil.example.com/logo.png",
      gallery_photos: ["https://media.verifymzansi.com/business/photo-1.jpg"],
      business_details: {
        type: "standalone_shop",
        street_address: "24 Vilakazi Street",
        suburb: "Orlando West",
      },
    });

    expect(result.success).toBe(false);
  });
});
