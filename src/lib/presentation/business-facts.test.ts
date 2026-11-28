import { describe, expect, it } from "vitest";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";
import {
  formatTourismPriceFrom,
  getBusinessTypeDetails,
  getTourismSpotlightFacts,
  getTourismViewerDetails,
  TOURISM_SPOTLIGHT_KEYS,
  tourismCancellationText,
} from "./business-facts";

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

describe("tourism From price, stay sizes, backup and cancellation", () => {
  it("shows the From price with its unit", () => {
    expect(formatTourismPriceFrom({ price_from_cents: 45000, price_unit: "night" })).toBe(
      "From R450 per night"
    );
    expect(formatTourismPriceFrom({ price_from_cents: 30000, price_unit: "person" })).toBe(
      "From R300 per person"
    );
    expect(formatTourismPriceFrom({ price_from_cents: 150000, price_unit: "unit" })).toMatch(
      /^From R1\s500 per unit$/
    );
    expect(formatTourismPriceFrom({ price_from_cents: 8000, price_unit: "entry" })).toBe(
      "Entry fee from R80"
    );
    expect(formatTourismPriceFrom({ price_from_cents: 8000 })).toBe("From R80");
    expect(formatTourismPriceFrom({ price_range: "midrange" })).toBeNull();
    expect(formatTourismPriceFrom({ price_from_cents: 0, price_unit: "night" })).toBeNull();
  });

  it("puts the new stay facts on the public tourism page card", () => {
    const facts = getTourismSpotlightFacts({
      price_from_cents: 45000,
      price_unit: "night",
      sleeps: 4,
      bedrooms: 2,
      beds: 3,
      bathrooms: 1,
      backup_utilities: ["water_tanks", "inverter_solar"],
      cancellation_policy: "free_until_days",
      cancellation_free_days: 7,
      tgcsa_grading: "3_star",
    });
    expect(facts.map(({ label, value }) => [label, value])).toEqual([
      ["Price", "From R450 per night"],
      ["Sleeps", "4"],
      ["Bedrooms", "2"],
      ["Beds", "3"],
      ["Bathrooms", "1"],
      ["Backup power and water", "Inverter or solar, Water tanks"],
      ["Cancellation", "Free cancellation until 7 days before"],
      ["TGCSA Grading", "3-star"],
    ]);
    // Every key the card reads is listed for pages that decide whether to show it.
    for (const key of ["price_from_cents", "sleeps", "backup_utilities", "opening_hours"]) {
      expect(TOURISM_SPOTLIGHT_KEYS).toContain(key);
    }
  });

  it("shows an attraction's entry fee and opening hours", () => {
    const facts = getTourismSpotlightFacts({
      price_from_cents: 8000,
      price_unit: "entry",
      opening_hours: "Daily 08:00 to 17:00",
    });
    expect(facts).toEqual([
      { label: "Price", value: "Entry fee from R80" },
      { label: "Opening hours", value: "Daily 08:00 to 17:00" },
    ]);
  });

  it("words the newer cancellation choices and leaves older ones to the details card", () => {
    expect(tourismCancellationText({ cancellation_policy: "deposit_non_refundable" })).toBe(
      "Deposit is non-refundable"
    );
    expect(tourismCancellationText({ cancellation_policy: "no_refunds" })).toBe("No refunds");
    expect(
      tourismCancellationText({ cancellation_policy: "free_until_days", cancellation_free_days: 1 })
    ).toBe("Free cancellation until 1 day before");
    expect(tourismCancellationText({ cancellation_policy: "moderate" })).toBeNull();
    expect(
      getTourismSpotlightFacts({ cancellation_policy: "moderate" }).map((fact) => fact.label)
    ).not.toContain("Cancellation");
  });

  it("gives the viewer the price, sizes, backup list and cancellation wording", () => {
    const details = getTourismViewerDetails({
      price_from_cents: 45000,
      price_unit: "night",
      sleeps: 2,
      backup_utilities: ["borehole"],
      cancellation_policy: "no_refunds",
    });
    expect(details.facts).toEqual(
      expect.arrayContaining([
        { label: "Price", value: "From R450 per night" },
        { label: "Sleeps", value: "2" },
      ])
    );
    expect(details.lists).toContainEqual({ label: "Backup power and water", items: ["Borehole"] });
    expect(details.rules).toContainEqual({ label: "Cancellation", value: "No refunds" });
  });
});
