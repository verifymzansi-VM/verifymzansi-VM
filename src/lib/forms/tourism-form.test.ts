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

  it("needs at least one photo or video, and a video alone is enough", () => {
    expect(validateTourismStep(3, tour({}), 0, 0).images).toBe("Add at least one photo or video.");
    expect(validateTourismStep(3, tour({}), 0, 1, 1).images).toBeUndefined();
    expect(validateTourismStep(3, tour({}), 1, 0).images).toBeUndefined();
    const event = tour({ listingType: "event" });
    expect(validateTourismStep(3, event, 0, 0).images).toBe("Add at least one photo or video.");
    expect(validateTourismStep(3, event, 0, 1).images).toBeUndefined();
  });

  it("asks a tourism business with a video but no cover frame to pick one", () => {
    const errors = validateTourismStep(3, tour({}), 0, 1, 0);
    expect(errors.video_thumbnail).toBe("Add a photo, or a cover image for the video.");
    expect(validateTourismStep(3, tour({}), 0, 1, 1).video_thumbnail).toBeUndefined();
    expect(validateTourismStep(3, tour({}), 1, 1, 0).video_thumbnail).toBeUndefined();
  });

  it.each(["guest_house_bnb", "spa_wellness_retreat", "cultural_heritage"])(
    "lets a %s post without a street address or suburb",
    (subcategory) => {
      const errors = validateTourismStep(2, tour({ subcategory, joinMethods: [] }), 0);
      expect(errors.locationAddress).toBeUndefined();
      expect(errors.locationTown).toBeUndefined();
    }
  );

  it("still requires a province and city", () => {
    const errors = validateTourismStep(
      2,
      tour({ subcategory: "guest_house_bnb", province: "", city: "" }),
      0
    );
    expect(errors.province).toBeDefined();
    expect(errors.city).toBeDefined();
  });

  it("uses the verified account number for Call and WhatsApp, with nothing typed", () => {
    const contacts = (contactMethods: string[], phone: string) =>
      validateTourismStep(
        2,
        tour({ subcategory: "guest_house_bnb", contactMethods, phone, whatsapp: phone }),
        0
      );
    // Without a verified number, Call and WhatsApp are refused.
    for (const methods of [["call"], ["whatsapp"], ["call", "form"]]) {
      expect(contacts(methods, "").contactMethods, methods.join()).toBe(
        "Verify a number on your account to use Call or WhatsApp."
      );
    }
    // With one they pass; the contact form alone never needs a number.
    expect(contacts(["call", "whatsapp"], "0821234567")).toEqual({});
    expect(contacts(["form"], "")).toEqual({});
    expect(contacts([], "0821234567").contactMethods).toBe("Choose at least one contact method.");
    // No typed-number errors any more.
    expect(contacts(["call", "whatsapp"], "0821234567")).not.toHaveProperty("phone");
    expect(contacts(["call", "whatsapp"], "0821234567")).not.toHaveProperty("whatsapp");
  });

  it.each([
    "hotel_resort",
    "guest_house_bnb",
    "spa_wellness_retreat",
    "tourist_attraction",
    "cultural_heritage",
  ])("does not ask how visitors join a fixed venue (%s)", (subcategory) => {
    expect(validateTourismStep(2, tour({ subcategory }), 0)).not.toHaveProperty("joinMethods");
  });

  it.each(["tour_operator", "safari_wildlife", "adventure_activities"])(
    "asks how visitors join a tour or experience (%s)",
    (subcategory) => {
      expect(validateTourismStep(2, tour({ subcategory }), 0)).toHaveProperty("joinMethods");
    }
  );

  it("checks the From price, stay sizes, cancellation days and opening hours", () => {
    const step1 = (overrides: Record<string, unknown>) =>
      validateTourismStep(1, tour({ subcategory: "guest_house_bnb", ...overrides }), 0);
    expect(
      step1({ priceFrom: "450", sleeps: "4", bedrooms: "0", beds: "3", bathrooms: "1" })
    ).toEqual({});
    expect(step1({ priceFrom: "0" }).priceFrom).toBe("Enter a price above R0, or leave it blank.");
    expect(step1({ priceFrom: "450.555" }).priceFrom).toBe(
      "Price can have at most 2 decimal places."
    );
    expect(step1({ sleeps: "0" }).sleeps).toBe("Sleeps must be a whole number of 1 or more.");
    expect(step1({ beds: "2.5" }).beds).toBe("Beds must be a whole number of 0 or more.");
    expect(step1({ cancellationPolicy: "free_until_days" }).cancellationFreeDays).toBe(
      "Enter the number of days (1 to 365)."
    );
    expect(step1({ cancellationPolicy: "free_until_days", cancellationFreeDays: "7" })).toEqual({});
    expect(step1({ cancellationPolicy: "no_refunds" })).toEqual({});
    // Stay sizes are only checked for stays; opening hours only for attractions.
    expect(validateTourismStep(1, tour({ sleeps: "0" }), 0)).toEqual({});
    expect(
      validateTourismStep(
        1,
        tour({ subcategory: "tourist_attraction", openingHours: "x".repeat(121) }),
        0
      ).openingHours
    ).toBe("Opening hours cannot exceed 120 characters.");
  });

  it("checks the event doors-open time and refund days for paid events", () => {
    const event = (overrides: Record<string, unknown>) =>
      validateTourismStep(
        1,
        tour({
          listingType: "event",
          eventType: "festival_concert",
          startDate: "2099-12-01T18:00",
          priceZar: "150",
          ...overrides,
        }),
        0
      );
    expect(event({ doorsOpen: "17:30" })).toEqual({});
    expect(event({ doorsOpen: "25:00" }).doorsOpen).toBe("Choose a doors-open time.");
    expect(event({ refundPolicy: "full_until_days" }).refundDays).toBe(
      "Enter the number of days (1 to 365)."
    );
    expect(event({ refundPolicy: "full_until_days", refundDays: "3" })).toEqual({});
    // A free event has no refund to describe.
    expect(event({ priceZar: "0", refundPolicy: "full_until_days" })).toEqual({});
  });

  it("checks the YouTube link like the other links", () => {
    expect(validateTourismStep(2, tour({ socialYoutube: "not a link" }), 0).socialYoutube).toBe(
      "Enter a valid YouTube URL."
    );
    expect(
      validateTourismStep(2, tour({ socialYoutube: "youtube.com/@soweto" }), 0)
    ).not.toHaveProperty("socialYoutube");
  });

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
