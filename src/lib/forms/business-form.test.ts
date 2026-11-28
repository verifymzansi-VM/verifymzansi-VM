import { describe, expect, it } from "vitest";
import {
  EMPTY_BUSINESS_HOURS,
  PAYMENT_METHOD_OPTIONS,
  businessHoursPayload,
  isVisitOnlyDetails,
  parseDayHours,
  readBusinessHours,
  readVisitDetails,
  validateBusinessForm,
  withVisitDetails,
} from "./business-form";
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

describe("business-form YouTube link", () => {
  it("validates the YouTube URL like the other social links", () => {
    expect(
      validateBusinessForm({
        businessType: "mobile_service",
        businessDetails: getDefaultBusinessDetails("mobile_service"),
        storeNumber: "",
        mapDirections: "",
        phone: "",
        whatsapp: "",
        website: "",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialTiktok: "",
        socialYoutube: "not a url",
      }).socialYoutube
    ).toBe("Enter a valid YouTube URL.");
  });
});

describe("payment method options", () => {
  it("offers the four new methods with plain labels", () => {
    expect(PAYMENT_METHOD_OPTIONS).toEqual(
      expect.arrayContaining([
        { value: "zapper", label: "Zapper" },
        { value: "card_machine", label: "Card machine" },
        { value: "cash_on_delivery", label: "Cash on delivery" },
        { value: "instant_eft", label: "Instant EFT" },
      ])
    );
  });
});

describe("opening hours", () => {
  it("stores each group as text, plus public holidays and the two flags", () => {
    expect(
      businessHoursPayload({
        ...EMPTY_BUSINESS_HOURS,
        monFri: { open: "08:00", close: "17:00", closed: false },
        sat: { open: "09:00", close: "", closed: false },
        publicHolidays: { open: "", close: "", closed: true },
        byAppointment: true,
      })
    ).toEqual({
      Mon_Fri: "08:00 - 17:00",
      Sun: "Closed",
      Public_holidays: "Closed",
      By_appointment: true,
    });
  });

  it("stores only the flag when open 24 hours", () => {
    expect(
      businessHoursPayload({
        ...EMPTY_BUSINESS_HOURS,
        monFri: { open: "08:00", close: "17:00", closed: false },
        open24: true,
      })
    ).toEqual({ Open_24_hours: true });
  });

  it("reads stored hours back, any minute and older spellings", () => {
    expect(parseDayHours("8:15-17:45")).toEqual({ open: "08:15", close: "17:45", closed: false });
    expect(parseDayHours("Closed")).toEqual({ open: "", close: "", closed: true });
    expect(parseDayHours("8am - 2pm")).toEqual({ open: "", close: "", closed: false });
    expect(
      readBusinessHours({
        Mon_Fri: "08:00 - 17:00",
        Public_holidays: "10:00 - 14:00",
        Open_24_hours: false,
        By_appointment: true,
      })
    ).toEqual({
      monFri: { open: "08:00", close: "17:00", closed: false },
      sat: { open: "", close: "", closed: false },
      sun: { open: "", close: "", closed: false },
      publicHolidays: { open: "10:00", close: "14:00", closed: false },
      open24: false,
      byAppointment: true,
    });
    expect(readBusinessHours({ Mon_Fri: "By appointment" }).byAppointment).toBe(true);
  });

  it("round-trips the form state through the stored shape", () => {
    const hours = {
      ...EMPTY_BUSINESS_HOURS,
      monFri: { open: "07:30", close: "18:00", closed: false },
      publicHolidays: { open: "09:00", close: "13:00", closed: false },
      byAppointment: true,
    };
    expect(readBusinessHours(businessHoursPayload(hours))).toEqual(hours);
  });
});

describe("visit details", () => {
  it("adds walk-ins and visitor features to just the type", () => {
    expect(
      withVisitDetails(null, "home_business", {
        walkInPolicy: "walk_ins_welcome",
        visitorFeatures: ["parking", "kid_friendly"],
      })
    ).toEqual({
      type: "home_business",
      walk_in_policy: "walk_ins_welcome",
      visitor_features: ["parking", "kid_friendly"],
    });
    expect(
      withVisitDetails(null, "home_business", { walkInPolicy: "", visitorFeatures: [] })
    ).toBeUndefined();
  });

  it("keeps older full details and replaces only the visit facts", () => {
    expect(
      withVisitDetails(
        {
          type: "standalone_shop",
          street_address: "1 Main Rd",
          suburb: "Arcadia",
          walk_in_policy: "appointment_only",
        },
        "standalone_shop",
        { walkInPolicy: "", visitorFeatures: ["wheelchair_access"] }
      )
    ).toEqual({
      type: "standalone_shop",
      street_address: "1 Main Rd",
      suburb: "Arcadia",
      visitor_features: ["wheelchair_access"],
    });
  });

  it("reads the visit facts and tells visit-only details apart", () => {
    const details = {
      type: "mall_store",
      walk_in_policy: "walk_ins_welcome",
      visitor_features: ["kid_friendly", "unknown"],
    };
    expect(readVisitDetails(details)).toEqual({
      walkInPolicy: "walk_ins_welcome",
      visitorFeatures: ["kid_friendly"],
    });
    expect(readVisitDetails(null)).toEqual({ walkInPolicy: "", visitorFeatures: [] });
    expect(isVisitOnlyDetails(details)).toBe(true);
    expect(isVisitOnlyDetails({ type: "mall_store", mall_name: "Mall" })).toBe(false);
    expect(isVisitOnlyDetails(null)).toBe(false);
  });
});
