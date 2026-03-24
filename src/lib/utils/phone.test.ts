import { describe, it, expect } from "vitest";
import {
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
