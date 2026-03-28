import { describe, expect, it } from "vitest";
import { parseServiceAreas, validateBusinessForm } from "./business-form";
import { getDefaultBusinessDetails } from "./business-type-details";

describe("business-form helpers", () => {
  it("normalizes service areas into a trimmed list", () => {
    expect(parseServiceAreas(" Sandton, Midrand , Soweto ")).toEqual([
      "Sandton",
      "Midrand",
      "Soweto",
    ]);
  });

  it("requires service areas for mobile services and validates social URLs", () => {
    expect(
      validateBusinessForm({
        businessType: "mobile_service",
        businessDetails: getDefaultBusinessDetails("mobile_service"),
        storeNumber: "",
        serviceAreasInput: " , ",
        mapDirections: "",
        phone: "",
        whatsapp: "",
        email: "",
        website: "",
        socialFacebook: "not-a-url",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
      })
    ).toMatchObject({
      service_areas: "Add at least one service area.",
      socialFacebook: "Enter a valid Facebook URL.",
    });
  });

  it("requires standalone shop address details", () => {
    expect(
      validateBusinessForm({
        businessType: "standalone_shop",
        businessDetails: getDefaultBusinessDetails("standalone_shop"),
        storeNumber: "",
        serviceAreasInput: "",
        mapDirections: "",
        phone: "",
        whatsapp: "",
        email: "",
        website: "",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
      })
    ).toMatchObject({
      "business_details.street_address": "Street address is required.",
      "business_details.suburb": "Suburb is required.",
    });
  });

  it("does not require delivery region details for online-only businesses", () => {
    expect(
      validateBusinessForm({
        businessType: "online_only",
        businessDetails: {
          type: "online_only",
          primary_order_channel: "website",
          order_url: "https://orders.example.com",
          support_response_time: "",
        },
        storeNumber: "",
        serviceAreasInput: "",
        mapDirections: "",
        phone: "",
        whatsapp: "",
        email: "",
        website: "",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
      })
    ).toEqual({});
  });
});
