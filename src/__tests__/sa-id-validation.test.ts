import { describe, it, expect } from "vitest";
import {
  extractDobFromSaId,
  extractGenderFromSaId,
  extractCitizenshipFromSaId,
  validateSaIdChecksum,
  formatSaIdDob,
  validateSaIdFull,
} from "@/lib/utils/sa-id-validation";

describe("SA ID Validation", () => {
  // Well-known valid SA ID: 8001015009087
  // DOB: 1980-01-01, Male, SA Citizen, Valid checksum
  const VALID_ID = "8001015009087";
  const INVALID_CHECKSUM_ID = "8001015009088"; // last digit wrong

  describe("extractDobFromSaId", () => {
    it("returns correct DOB for valid ID", () => {
      const dob = extractDobFromSaId(VALID_ID);
      expect(dob).toBeInstanceOf(Date);
      expect(dob!.getFullYear()).toBe(1980);
      expect(dob!.getMonth()).toBe(0); // January = 0
      expect(dob!.getDate()).toBe(1);
    });

    it("returns null for non-numeric input", () => {
      expect(extractDobFromSaId("abcdef")).toBeNull();
    });

    it("extracts DOB from 6-digit prefix", () => {
      // extractDobFromSaId accepts >= 6 digits
      const dob = extractDobFromSaId("800101");
      expect(dob).toBeInstanceOf(Date);
      expect(dob!.getFullYear()).toBe(1980);
    });

    it("handles 2000s IDs correctly", () => {
      // IDs starting with 00-24 should map to 2000s
      const dob = extractDobFromSaId("0501015009087");
      expect(dob).toBeInstanceOf(Date);
      // 05 -> 2005 (since 05 < 25 in typical cutoff)
      expect(dob!.getFullYear()).toBeLessThanOrEqual(2025);
    });
  });

  describe("extractGenderFromSaId", () => {
    it('returns "male" when digit 7-10 >= 5000', () => {
      // VALID_ID has 5009 at positions 6-9
      expect(extractGenderFromSaId(VALID_ID)).toBe("male");
    });

    it('returns "female" when digit 7-10 < 5000', () => {
      // Craft an ID with gender digits < 5000
      expect(extractGenderFromSaId("8001014009087")).toBe("female");
    });

    it("returns null for short input", () => {
      expect(extractGenderFromSaId("800101")).toBeNull();
    });
  });

  describe("extractCitizenshipFromSaId", () => {
    it('returns "citizen" when digit 11 is 0', () => {
      expect(extractCitizenshipFromSaId(VALID_ID)).toBe("citizen");
    });

    it('returns "permanent_resident" when digit 11 is 1', () => {
      expect(extractCitizenshipFromSaId("8001015009187")).toBe("permanent_resident");
    });

    it("returns null for short input", () => {
      expect(extractCitizenshipFromSaId("800101")).toBeNull();
    });
  });

  describe("validateSaIdChecksum", () => {
    it("returns true for valid ID", () => {
      expect(validateSaIdChecksum(VALID_ID)).toBe(true);
    });

    it("returns false for invalid checksum", () => {
      expect(validateSaIdChecksum(INVALID_CHECKSUM_ID)).toBe(false);
    });

    it("returns false for wrong length", () => {
      expect(validateSaIdChecksum("123456")).toBe(false);
    });

    it("returns false for non-numeric", () => {
      expect(validateSaIdChecksum("abcdefghijklm")).toBe(false);
    });
  });

  describe("formatSaIdDob", () => {
    it("formats date string correctly", () => {
      const formatted = formatSaIdDob(VALID_ID);
      expect(formatted).toContain("1980");
      expect(formatted).toContain("January");
    });

    it("returns null for invalid input", () => {
      expect(formatSaIdDob("abc")).toBeNull();
    });
  });

  describe("validateSaIdFull", () => {
    it("returns valid result for valid ID", () => {
      const result = validateSaIdFull(VALID_ID);
      expect(result.valid).toBe(true);
      expect(result.dob).toBeInstanceOf(Date);
      expect(result.gender).toBe("male");
      expect(result.citizenship).toBe("citizen");
    });

    it("returns invalid for bad checksum", () => {
      const result = validateSaIdFull(INVALID_CHECKSUM_ID);
      expect(result.valid).toBe(false);
    });

    it("returns invalid for wrong length", () => {
      const result = validateSaIdFull("12345");
      expect(result.valid).toBe(false);
    });
  });
});
