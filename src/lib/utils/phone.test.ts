import { describe, it, expect } from "vitest";
import {
  businessNumber,
  sanitizeSaPhoneInput,
  normalizeSaPhone,
  buildAccountPhoneFields,
  buildSellerPhoneFields,
} from "./phone";

describe("sanitizeSaPhoneInput", () => {
  it("strips spacing and punctuation from local numbers", () => {
    expect(sanitizeSaPhoneInput("082 123 4567")).toBe("0821234567");
  });

  it("recovers international numbers even when the plus sign is misplaced", () => {
    expect(sanitizeSaPhoneInput("27+ 64 933 4601")).toBe("+27649334601");
  });
});

describe("normalizeSaPhone", () => {
  it("formats +27 from 27-prefixed 11-digit number", () => {
    expect(normalizeSaPhone("27821234567")).toBe("+27821234567");
  });

  it("converts 0-prefixed 10-digit local number to +27", () => {
    expect(normalizeSaPhone("0821234567")).toBe("+27821234567");
  });

  it("returns trimmed input for non-matching patterns", () => {
    expect(normalizeSaPhone("  +27821234567  ")).toBe("+27821234567");
  });

  it("normalizes spaced local numbers", () => {
    expect(normalizeSaPhone("082 123 4567")).toBe("+27821234567");
  });

  it("returns trimmed input for short numbers", () => {
    expect(normalizeSaPhone("12345")).toBe("12345");
  });
});

describe("buildAccountPhoneFields", () => {
  it("returns nulls for null input", () => {
    expect(buildAccountPhoneFields(null)).toEqual({ phone: null, masked_phone_public: null });
  });

  it("returns nulls for undefined input", () => {
    expect(buildAccountPhoneFields(undefined)).toEqual({ phone: null, masked_phone_public: null });
  });

  it("returns nulls for empty string", () => {
    expect(buildAccountPhoneFields("  ")).toEqual({ phone: null, masked_phone_public: null });
  });

  it("normalizes and masks a valid phone", () => {
    const result = buildAccountPhoneFields("0821234567");
    expect(result.phone).toBe("+27821234567");
    expect(result.masked_phone_public).toBeTruthy();
  });
});

describe("buildSellerPhoneFields", () => {
  it("is an alias for buildAccountPhoneFields", () => {
    expect(buildSellerPhoneFields).toBe(buildAccountPhoneFields);
  });
});

describe("businessNumber", () => {
  it("takes a 01x-05x landline or a 06x, 071-074, 076-079, 081-084 mobile", () => {
    expect(businessNumber("031 123 4567")).toEqual({ number: "+27311234567", kind: "landline" });
    expect(businessNumber("(011) 123-4567")).toEqual({ number: "+27111234567", kind: "landline" });
    expect(businessNumber("27511234567")).toEqual({ number: "+27511234567", kind: "landline" });
    expect(businessNumber("+27821234567")).toEqual({ number: "+27821234567", kind: "mobile" });
    for (const prefix of ["060", "069", "071", "074", "076", "079", "081", "084"])
      expect(businessNumber(`${prefix}1234567`)?.kind, prefix).toBe("mobile");
    for (const prefix of ["010", "021", "031", "041", "058"])
      expect(businessNumber(`${prefix}1234567`)?.kind, prefix).toBe("landline");
  });
  it("takes 087, 0800, 0860 and 0861 as call-only numbers", () => {
    expect(businessNumber("087 123 4567")).toEqual({
      number: "+27871234567",
      kind: "non-geographic",
    });
    expect(businessNumber("0800 123 456")).toEqual({
      number: "+27800123456",
      kind: "non-geographic",
    });
    expect(businessNumber("0860 123 456")).toEqual({
      number: "+27860123456",
      kind: "non-geographic",
    });
    expect(businessNumber("+27861123456")).toEqual({
      number: "+27861123456",
      kind: "non-geographic",
    });
  });
  it("refuses other 080 and 086 ranges, other numbers and anything else", () => {
    for (const value of [
      "0701234567",
      "0751234567",
      "0801234567",
      "0811234",
      "0851234567",
      "0862123456",
      "0865123456",
      "0866123456",
      "0867123456",
      "0869123456",
      "08712345678",
      "0911234567",
      "082123456",
      "082 *** 4567",
      "",
      null,
      undefined,
    ])
      expect(businessNumber(value), String(value)).toBeNull();
  });
});
