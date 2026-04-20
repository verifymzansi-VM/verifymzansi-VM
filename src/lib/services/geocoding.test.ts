import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reverseGeocode, computeLocationConfidence } from "./geocoding";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function nominatimResponse(state: string, city?: string) {
  return {
    ok: true,
    json: async () => ({
      address: {
        state,
        ...(city ? { city } : {}),
      },
    }),
  };
}

describe("reverseGeocode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEOCODING_API_URL", "https://nominatim.openstreetmap.org");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects coordinates outside South Africa", async () => {
    const result = await reverseGeocode(51.5, -0.1); // London
    expect(result.source).toBe("failed");
    expect(result.province).toBeNull();
  });

  it("rejects coordinates south of SA bounding box", async () => {
    const result = await reverseGeocode(-40, 25);
    expect(result.source).toBe("failed");
  });

  it("returns Nominatim result when API succeeds", async () => {
    mockFetch.mockResolvedValueOnce(nominatimResponse("Gauteng", "Johannesburg"));

    const result = await reverseGeocode(-26.2, 28.0); // Johannesburg area
    expect(result.source).toBe("nominatim");
    expect(result.province).toBe("Gauteng");
    expect(result.city).toBe("Johannesburg");
  });

  it("maps alternative province names", async () => {
    mockFetch.mockResolvedValueOnce(nominatimResponse("Kwa-Zulu Natal", "Durban"));

    const result = await reverseGeocode(-29.8, 31.0); // Durban area
    expect(result.province).toBe("KwaZulu-Natal");
  });

  it("falls back to bounding-box when Nominatim fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Nominatim down"));

    // Coordinates roughly in Gauteng
    const result = await reverseGeocode(-26.2, 28.0);
    expect(result.source).toBe("bounding_box");
    // Province may or may not match depending on bounding-box precision
    expect(["bounding_box", "failed"]).toContain(result.source);
  });

  it("falls back when Nominatim returns no province", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ address: {} }),
    });

    const result = await reverseGeocode(-26.2, 28.0);
    // Either bounding_box or failed, not nominatim since province was null
    expect(result.source).not.toBe("nominatim");
  });
});

describe("computeLocationConfidence", () => {
  it("returns 'none' when GPS province is null", () => {
    expect(computeLocationConfidence(null, "Gauteng", null, "Johannesburg", 50)).toBe("none");
  });

  it("returns 'high' for equivalent canonical city aliases with good accuracy", () => {
    expect(
      computeLocationConfidence(
        "Eastern Cape",
        "Eastern Cape",
        "Gqeberha",
        "Port Elizabeth (Gqeberha)",
        30
      )
    ).toBe("high");
  });

  it("returns 'low' when province does not match", () => {
    expect(
      computeLocationConfidence("Western Cape", "Gauteng", "Cape Town", "Johannesburg", 30)
    ).toBe("low");
  });

  it("returns 'high' when province + city match with good accuracy", () => {
    expect(
      computeLocationConfidence("Gauteng", "Gauteng", "Johannesburg", "Johannesburg", 30)
    ).toBe("high");
  });

  it("returns 'medium' when province matches but city does not", () => {
    expect(computeLocationConfidence("Gauteng", "Gauteng", "Pretoria", "Johannesburg", 30)).toBe(
      "medium"
    );
  });

  it("returns 'medium' when province and city match but accuracy is poor", () => {
    expect(
      computeLocationConfidence("Gauteng", "Gauteng", "Johannesburg", "Johannesburg", 5000)
    ).toBe("medium");
  });

  it("is case-insensitive for province and city comparison", () => {
    expect(
      computeLocationConfidence("gauteng", "GAUTENG", "johannesburg", "JOHANNESBURG", 10)
    ).toBe("high");
  });
});
