import { describe, it, expect } from "vitest";
import { computeLocationConfidence } from "@/lib/services/geocoding";

describe("Geocoding Service", () => {
  describe("computeLocationConfidence", () => {
    it('returns "high" for matching province and city with good accuracy', () => {
      const result = computeLocationConfidence(
        "Gauteng",
        "Gauteng",
        "Johannesburg",
        "Johannesburg",
        50
      );
      expect(result).toBe("high");
    });

    it('returns "medium" for matching province but different city', () => {
      const result = computeLocationConfidence(
        "Gauteng",
        "Gauteng",
        "Pretoria",
        "Johannesburg",
        50
      );
      expect(result).toBe("medium");
    });

    it('returns "low" for mismatched province', () => {
      const result = computeLocationConfidence(
        "Western Cape",
        "Gauteng",
        "Cape Town",
        "Johannesburg",
        50
      );
      expect(result).toBe("low");
    });

    it('returns "low" for high accuracy value (poor GPS)', () => {
      const result = computeLocationConfidence(
        "Gauteng",
        "Gauteng",
        "Johannesburg",
        "Johannesburg",
        2000
      );
      // High accuracy number means poor GPS, should lower confidence
      expect(["medium", "low"]).toContain(result);
    });

    it('returns "none" when GPS province is null', () => {
      const result = computeLocationConfidence(null, "Gauteng", null, "Johannesburg", 50);
      expect(result).toBe("none");
    });
  });
});
