import { describe, expect, it } from "vitest";
import { validateTourismStep } from "@/lib/forms/tourism-form";
import { businessSchema } from "@/lib/validations/business-unified";

describe("validateTourismStep event compatibility", () => {
  it("accepts valid event basics without introducing validation errors", () => {
    const errors = validateTourismStep(
      0,
      {
        listingType: "event",
        title: "Cape Town Weekend Market",
        description: "Family-friendly weekend market with local food, crafts, and live music.",
        province: "Western Cape",
        city: "Cape Town",
        contactMethods: ["call"],
        subcategory: "",
        starRating: "",
        numberOfRooms: "",
        bookingUrl: "",
        languagesSpoken: "",
        phone: "",
        whatsapp: "",
        email: "",
        website: "",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
        treatmentTypes: [],
        activityTypes: [],
        tourDuration: "",
        maxGroupSize: "",
        difficultyLevel: "",
        equipmentProvided: false,
        whatsIncluded: "",
        tourismAgeRestriction: "",
        servicesOffered: [],
        tourismSpecializations: [],
        guidedTours: false,
        audioGuide: false,
        visitDuration: "",
        vehicleTypes: [],
        deliveryCollection: false,
        minDriverAge: "",
        insuranceIncluded: false,
        gpsAvailable: false,
        eventType: "festival",
        startDate: "2026-05-01",
        endDate: "2026-05-02",
        priceZar: "",
        venueName: "Green Point",
        venueCapacity: "",
        ticketsUrl: "",
      },
      0
    );

    expect(errors).toEqual({});
  });

  it("allows video-only media on the event media step", () => {
    const errors = validateTourismStep(
      3,
      {
        listingType: "event",
        title: "Cape Town Weekend Market",
        description: "Family-friendly weekend market with local food, crafts, and live music.",
        province: "Western Cape",
        city: "Cape Town",
        contactMethods: ["call"],
        subcategory: "",
        starRating: "",
        numberOfRooms: "",
        bookingUrl: "",
        languagesSpoken: "",
        phone: "",
        whatsapp: "",
        email: "",
        website: "",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
        treatmentTypes: [],
        activityTypes: [],
        tourDuration: "",
        maxGroupSize: "",
        difficultyLevel: "",
        equipmentProvided: false,
        whatsIncluded: "",
        tourismAgeRestriction: "",
        servicesOffered: [],
        tourismSpecializations: [],
        guidedTours: false,
        audioGuide: false,
        visitDuration: "",
        vehicleTypes: [],
        deliveryCollection: false,
        minDriverAge: "",
        insuranceIncluded: false,
        gpsAvailable: false,
        eventType: "festival",
        startDate: "2026-05-01",
        endDate: "2026-05-02",
        priceZar: "",
        venueName: "Green Point",
        venueCapacity: "",
        ticketsUrl: "",
      },
      0,
      1
    );

    expect(errors).toEqual({});
  });
});

describe("validateTourismStep tours and experiences", () => {
  const tour = (overrides: Record<string, unknown>) =>
    ({
      listingType: "tourism_business",
      title: "Soweto Heritage Walk",
      description: "A guided walking tour through the history of Orlando West.",
      province: "Gauteng",
      city: "Johannesburg",
      contactMethods: ["form"],
      subcategory: "tour_operator",
      starRating: "",
      numberOfRooms: "",
      bookingUrl: "",
      languagesSpoken: "",
      phone: "",
      whatsapp: "",
      email: "",
      website: "",
      socialFacebook: "",
      socialInstagram: "",
      socialTwitter: "",
      socialTiktok: "",
      treatmentTypes: [],
      activityTypes: [],
      tourDuration: "",
      maxGroupSize: "",
      difficultyLevel: "",
      equipmentProvided: false,
      whatsIncluded: "",
      tourismAgeRestriction: "",
      servicesOffered: [],
      tourismSpecializations: [],
      guidedTours: false,
      audioGuide: false,
      visitDuration: "",
      vehicleTypes: [],
      deliveryCollection: false,
      minDriverAge: "",
      insuranceIncluded: false,
      gpsAvailable: false,
      eventType: "",
      startDate: "",
      endDate: "",
      priceZar: "",
      venueName: "",
      venueCapacity: "",
      ticketsUrl: "",
      ...overrides,
    }) as Parameters<typeof validateTourismStep>[1];

  it("asks how visitors join without requiring an office address", () => {
    const errors = validateTourismStep(2, tour({}), 0);
    expect(errors.joinMethods).toBeDefined();
    expect(errors.locationAddress).toBeUndefined();
  });

  it.each([
    [100, 3000, true],
    [101, 3000, false],
    [100, 3001, false],
  ])(
    "matches the business API at title=%i and description=%i",
    (titleLength, descriptionLength, valid) => {
      const title = "t".repeat(titleLength);
      const description = "d".repeat(descriptionLength);
      const errors = validateTourismStep(0, tour({ title, description }));

      expect(Object.keys(errors).length === 0).toBe(valid);
      expect(errors.title === undefined).toBe(
        businessSchema.shape.business_name.safeParse(title).success
      );
      expect(errors.description === undefined).toBe(
        businessSchema.shape.description.safeParse(description).success
      );
    }
  );

  it("uses the API's trimmed lengths for business text", () => {
    expect(
      validateTourismStep(
        0,
        tour({ title: ` ${"t".repeat(100)} `, description: ` ${"d".repeat(3000)} ` })
      )
    ).toEqual({});
  });

  it.each([
    [120, 5000, true],
    [121, 5000, false],
    [120, 5001, false],
  ])(
    "keeps separate event bounds at title=%i and description=%i",
    (titleLength, descriptionLength, valid) => {
      const errors = validateTourismStep(
        0,
        tour({
          listingType: "event",
          eventType: "festival_concert",
          title: "t".repeat(titleLength),
          description: "d".repeat(descriptionLength),
        })
      );
      expect(Object.keys(errors).length === 0).toBe(valid);
    }
  );

  it("requires the details for each selected join method only", () => {
    expect(
      validateTourismStep(2, tour({ joinMethods: ["meeting_point"] }), 0).meetingPoint
    ).toBeDefined();
    expect(validateTourismStep(2, tour({ joinMethods: ["pickup"] }), 0).pickupAreas).toBeDefined();
    expect(
      validateTourismStep(
        2,
        tour({ joinMethods: ["meeting_point"], meetingPoint: "Vilakazi Street" }),
        0
      )
    ).toEqual({});
  });
});
