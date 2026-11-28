import { describe, expect, it } from "vitest";
import { businessSchema } from "@/lib/validations/business-unified";
import { buildBusinessMutationPayload } from "./business-mutation-payload";

const access = { version: 2, methods: ["visit"], premises: "home_business", publishAddress: false };

function save(extra: Record<string, unknown>) {
  return buildBusinessMutationPayload(
    businessSchema.parse({
      business_name: "Lerato Nails",
      slug: "lerato-nails-ab12",
      description: "Nails at home.",
      category: "beauty_personal",
      business_type: "home_business",
      location_province: "Gauteng",
      location_city: "Soweto",
      contact_methods: ["call"],
      phone: "0821234567",
      ...extra,
      category_details: { customer_access: access, ...(extra.category_details as object) },
    })
  );
}

describe("buildBusinessMutationPayload: new business fields", () => {
  it("keeps the booking link for a category without a booking field", () => {
    const saved = save({ category_details: { booking_url: " https://book.example.com/x " } });
    expect(saved.category_details.booking_url).toBe("https://book.example.com/x");
    expect(save({ category_details: { booking_url: "" } }).category_details).not.toHaveProperty(
      "booking_url"
    );
  });

  it("keeps the visit-only business details for the access form", () => {
    const saved = save({
      business_details: {
        type: "home_business",
        walk_in_policy: "walk_ins_welcome",
        visitor_features: ["parking", "kid_friendly"],
      },
    });
    expect(saved.business_details).toEqual({
      type: "home_business",
      walk_in_policy: "walk_ins_welcome",
      visitor_features: ["parking", "kid_friendly"],
    });
  });

  it("passes the new hours, payment methods and YouTube link through", () => {
    const saved = save({
      operating_hours: { Public_holidays: "Closed", Open_24_hours: true, By_appointment: true },
      payment_methods_accepted: ["zapper", "instant_eft"],
      social_links: { youtube: "https://youtube.com/@lerato" },
    });
    expect(saved.operating_hours).toEqual({
      Public_holidays: "Closed",
      Open_24_hours: true,
      By_appointment: true,
    });
    expect(saved.payment_methods_accepted).toEqual(["zapper", "instant_eft"]);
    expect(saved.social_links).toEqual({ youtube: "https://youtube.com/@lerato" });
  });
});
