import { describe, expect, it } from "vitest";
import {
  BUSINESS_FIELD_STEPS,
  LISTING_FIELD_STEPS,
  TOURISM_FIELD_STEPS,
  stepForField,
  stepForFieldErrors,
} from "./post-field-steps";

describe("post field steps", () => {
  it("sends nested server paths to the step that shows the field", () => {
    expect(stepForField("service_areas.areas", BUSINESS_FIELD_STEPS)).toBe(1);
    expect(
      stepForField("category_details.customer_access.deliveryAreas", BUSINESS_FIELD_STEPS)
    ).toBe(1);
    expect(stepForField("social_links.facebook", BUSINESS_FIELD_STEPS)).toBe(2);
    expect(stepForField("gallery_photos.2", BUSINESS_FIELD_STEPS)).toBe(3);
    expect(stepForField("attributes.property_type", LISTING_FIELD_STEPS)).toBe(0);
    expect(stepForField("images.0", LISTING_FIELD_STEPS)).toBe(2);
    expect(stepForField("price_mode", LISTING_FIELD_STEPS)).toBe(1);
    expect(stepForField("event_details.ticket_tiers.0.name", TOURISM_FIELD_STEPS)).toBe(1);
    expect(stepForField("category_details.meeting_point", TOURISM_FIELD_STEPS)).toBe(2);
    expect(stepForField("video_thumbnail", TOURISM_FIELD_STEPS)).toBe(3);
  });

  it("names the first tourism step for the category and event type", () => {
    expect(stepForField("eventType", TOURISM_FIELD_STEPS)).toBe(0);
    expect(stepForField("category_details.subcategory", TOURISM_FIELD_STEPS)).toBe(0);
  });

  it("opens the earliest step that has an error", () => {
    expect(
      stepForFieldErrors(
        { termsAccepted: "x", "service_areas.areas": "y" },
        BUSINESS_FIELD_STEPS,
        3
      )
    ).toBe(1);
    expect(stepForFieldErrors({}, BUSINESS_FIELD_STEPS, 3)).toBe(0);
  });
});
