import { describe, expect, it } from "vitest";
import { readSampleContact } from "./contact";

describe("VerifyMzansi's sample contact numbers", () => {
  it("is absent until a valid South African number is set", () => {
    expect(readSampleContact({})).toBeNull();
    expect(
      readSampleContact({ SAMPLE_CONTACT_PHONE: "", SAMPLE_CONTACT_WHATSAPP: " " })
    ).toBeNull();
    expect(readSampleContact({ SAMPLE_CONTACT_PHONE: "12345" })).toBeNull();
    expect(readSampleContact({ SAMPLE_CONTACT_WHATSAPP: "+44 20 7946 0958" })).toBeNull();
  });

  it("normalises each valid number and leaves out an invalid one", () => {
    expect(
      readSampleContact({ SAMPLE_CONTACT_PHONE: "082 123 4567", SAMPLE_CONTACT_WHATSAPP: "x" })
    ).toEqual({ phone: "+27821234567", whatsapp: null });
    expect(
      readSampleContact({
        SAMPLE_CONTACT_PHONE: "+27821234567",
        SAMPLE_CONTACT_WHATSAPP: "0821234568",
      })
    ).toEqual({ phone: "+27821234567", whatsapp: "+27821234568" });
  });
});
