import { describe, expect, it } from "vitest";
import { validateTourismStep } from "@/lib/forms/tourism-form";

describe("validateTourismStep socialAuthorization compatibility", () => {
  it("accepts event values containing socialAuthorization without introducing validation errors", () => {
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
        socialAuthorization: {
          granted: true,
          authorizerName: "Jane Owner",
          authorizerRole: "Director",
          relationship: "owner",
          monetizationAcknowledged: true,
          acceptedVersion: "v1",
        },
      },
      0
    );

    expect(errors).toEqual({});
  });
});
