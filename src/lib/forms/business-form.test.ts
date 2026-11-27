import { describe, expect, it } from "vitest";
import { validateBusinessForm } from "./business-form";
import { getDefaultBusinessDetails } from "./business-type-details";

describe("business-form helpers", () => {
  it("validates social URLs", () => {
    expect(
      validateBusinessForm({
        businessType: "mobile_service",
        businessDetails: getDefaultBusinessDetails("mobile_service"),
        storeNumber: "",
        mapDirections: "",
        phone: "",
        whatsapp: "",
        website: "",
        socialFacebook: "not-a-url",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
      })
    ).toMatchObject({
      socialFacebook: "Enter a valid Facebook URL.",
    });
  });

  it("requires standalone shop address details", () => {
    expect(
      validateBusinessForm({
        businessType: "standalone_shop",
        businessDetails: getDefaultBusinessDetails("standalone_shop"),
        storeNumber: "",
        mapDirections: "",
        phone: "",
        whatsapp: "",
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
        mapDirections: "",
        phone: "",
        whatsapp: "",
        website: "",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
      })
    ).toEqual({});
  });

  it("accepts URLs with accidental mobile-keyboard whitespace", () => {
    expect(
      validateBusinessForm({
        businessType: "online_only",
        businessDetails: {
          type: "online_only",
          primary_order_channel: "website",
          order_url: "https:// orders.example.com",
          support_response_time: "",
        },
        storeNumber: "",
        mapDirections: "",
        phone: "",
        whatsapp: "",
        website: "https:// www.booking.co.za",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
      })
    ).toEqual({});
  });

  it("takes a landline for calls but needs a mobile for WhatsApp", () => {
    const contacts = (phone: string, whatsapp: string) =>
      validateBusinessForm({
        businessType: "online_only",
        businessDetails: getDefaultBusinessDetails("online_only"),
        storeNumber: "",
        mapDirections: "",
        phone,
        whatsapp,
        website: "",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
      });
    expect(contacts("031 123 4567", "082 123 4567")).not.toHaveProperty("phone");
    expect(contacts("031 123 4567", "082 123 4567")).not.toHaveProperty("whatsapp");
    expect(contacts("", "031 123 4567").whatsapp).toBe("WhatsApp needs a mobile number.");
    // 087, 0800, 0860 and 0861 take calls only.
    for (const number of ["087 123 4567", "0800 123 456", "0860 123 456", "0861 123 456"]) {
      expect(contacts(number, ""), number).not.toHaveProperty("phone");
      expect(contacts("", number).whatsapp, number).toBe("WhatsApp needs a mobile number.");
    }
    expect(contacts("0862123456", "0801234567")).toMatchObject({
      phone: "Enter a valid South African number.",
      whatsapp: "Enter a valid South African WhatsApp number.",
    });
  });
});
