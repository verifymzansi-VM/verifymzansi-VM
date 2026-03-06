import { describe, expect, it } from "vitest";
import { parseServiceAreas, validateBusinessForm } from "./business-form";

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
        storeNumber: "",
        serviceAreasInput: " , ",
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
});
