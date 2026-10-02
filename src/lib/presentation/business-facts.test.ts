import { describe, expect, it } from "vitest";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";
import { getBusinessTypeDetails, getTourismViewerDetails } from "./business-facts";

describe("getTourismViewerDetails", () => {
  it("shows every filled tourism form field and leaves empty ones out", () => {
    const details = getTourismViewerDetails({
      number_of_rooms: 6,
      check_in_time: "14:00",
      price_range: "mid_range",
      amenities: ["pool", "wifi"],
      treatment_types: [],
      pets_allowed: false,
      smoking_allowed: true,
      cancellation_policy: "moderate",
      minimum_stay_nights: 1,
      whats_included: "Breakfast and a game drive",
      max_group_size: 0,
    });
    expect(details.facts.map((fact) => fact.label)).toEqual([
      "Rooms / units",
      "Check-in",
      "Price range",
    ]);
    expect(details.lists).toEqual([{ label: "Amenities", items: ["pool", "wifi"] }]);
    expect(details.rules).toEqual(
      expect.arrayContaining([
        { label: "Pets allowed", value: "No" },
        { label: "Smoking allowed", value: "Yes" },
        { label: "Minimum stay", value: "1 night" },
      ])
    );
    expect(details.notes).toEqual([
      { label: "What's included", value: "Breakfast and a game drive" },
    ]);
  });
});

describe("getBusinessTypeDetails", () => {
  const business = (business_details: unknown) =>
    ({ business_details }) as unknown as BusinessDetailRecord;

  it("reads the mall store step", () => {
    expect(
      getBusinessTypeDetails(
        business({ type: "mall_store", mall_name: "Boardwalk", floor_or_wing: "Upper level" })
      ).rows
    ).toEqual([
      { label: "Mall", value: "Boardwalk" },
      { label: "Floor or wing", value: "Upper level" },
    ]);
  });

  it("shows the area a home business serves, never a home address", () => {
    const result = getBusinessTypeDetails(
      business({
        type: "home_business",
        service_suburb: "Meerensee",
        appointment_required: true,
        customer_pickup_allowed: false,
      })
    );
    expect(result.rows).toEqual([
      { label: "Area served", value: "Meerensee" },
      { label: "Appointment needed", value: "Yes" },
      { label: "Collection from the owner", value: "No" },
    ]);
  });

  it("returns the order link and delivery regions of an online shop", () => {
    const result = getBusinessTypeDetails(
      business({
        type: "online_only",
        order_url: "https://shop.example.co.za",
        delivery_regions: ["Gauteng", "Western Cape"],
      })
    );
    expect(result.orderUrl).toBe("https://shop.example.co.za");
    expect(result.lists).toEqual([{ label: "Delivers to", items: ["Gauteng", "Western Cape"] }]);
  });

  it("copes with no details at all", () => {
    expect(getBusinessTypeDetails(business(null))).toEqual({ rows: [], orderUrl: null, lists: [] });
  });
});
