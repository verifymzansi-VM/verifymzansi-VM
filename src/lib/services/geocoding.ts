/**
 * Geocoding service — reverse geocode GPS coordinates to province/city.
 * Uses Nominatim (OpenStreetMap) API with fallback to bounding-box checks.
 */

import { SA_PROVINCES, isCoordInProvince } from "@/lib/constants/sa-provinces";
import {
  DEFAULT_NOMINATIM_URL,
  GEOCODING_REQUEST_TIMEOUT_MS,
  GPS_ACCURACY_WARN_METERS,
} from "@/lib/constants/verification";
import type { LocationConfidence } from "@/types/enums";

/**
 * Mapping from Nominatim "state" field to our province names.
 * Nominatim may return slightly different names.
 */
const NOMINATIM_STATE_TO_PROVINCE: Record<string, string> = {
  Gauteng: "Gauteng",
  "Western Cape": "Western Cape",
  "KwaZulu-Natal": "KwaZulu-Natal",
  "Eastern Cape": "Eastern Cape",
  "Free State": "Free State",
  Mpumalanga: "Mpumalanga",
  Limpopo: "Limpopo",
  "North West": "North West",
  "North-West": "North West",
  "Northern Cape": "Northern Cape",
  // Common alternative spellings
  "Kwa-Zulu Natal": "KwaZulu-Natal",
  "KwaZulu Natal": "KwaZulu-Natal",
  "Kwazulu-Natal": "KwaZulu-Natal",
};

export interface ReverseGeocodeResult {
  province: string | null;
  city: string | null;
  raw: Record<string, unknown>;
  source: "nominatim" | "bounding_box" | "failed";
}

/**
 * Reverse geocode GPS coordinates to province and city.
 * Tries Nominatim API first, falls back to bounding-box matching.
 */
// South Africa bounding box (generous)
const SA_LAT_MIN = -35;
const SA_LAT_MAX = -22;
const SA_LON_MIN = 16;
const SA_LON_MAX = 33;

export async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocodeResult> {
  // Validate coordinates are within South Africa
  if (lat < SA_LAT_MIN || lat > SA_LAT_MAX || lon < SA_LON_MIN || lon > SA_LON_MAX) {
    return {
      province: null,
      city: null,
      raw: { error: "Coordinates outside South Africa", lat, lon },
      source: "failed",
    };
  }

  // Try Nominatim first
  try {
    const result = await reverseGeocodeNominatim(lat, lon);
    if (result.province) {
      return result;
    }
  } catch (err) {
    console.warn(
      "[Geocoding] Nominatim request failed, falling back to bounding box:",
      err instanceof Error ? err.message : "unknown"
    );
  }

  // Fallback: bounding-box check
  return reverseGeocodeBoundingBox(lat, lon);
}

/**
 * Call Nominatim reverse geocoding API.
 */
async function reverseGeocodeNominatim(lat: number, lon: number): Promise<ReverseGeocodeResult> {
  const rawUrl = process.env.GEOCODING_API_URL || DEFAULT_NOMINATIM_URL;
  let baseUrl: string;
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.protocol.startsWith("http")) throw new Error("Invalid protocol");
    baseUrl = parsed.origin + parsed.pathname.replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid GEOCODING_API_URL: ${rawUrl}`);
  }
  const userAgent = process.env.NOMINATIM_USER_AGENT || "verifymzansi/1.0";

  const url = `${baseUrl}/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEOCODING_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Nominatim returned ${response.status}`);
    }

    let data: Record<string, unknown>;
    try {
      data = await response.json();
    } catch {
      throw new Error("Nominatim returned invalid JSON");
    }
    const address = (data.address || {}) as Record<string, string>;

    // Map the Nominatim state to our province name
    const rawState = address.state || "";
    const province = mapNominatimState(rawState);

    // Extract city — Nominatim uses various fields
    const city = address.city || address.town || address.municipality || address.village || null;

    return {
      province,
      city,
      raw: data,
      source: "nominatim",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fallback: match GPS coordinates to a province using bounding boxes.
 */
function reverseGeocodeBoundingBox(lat: number, lon: number): ReverseGeocodeResult {
  for (const province of SA_PROVINCES) {
    const inBounds = isCoordInProvince(lat, lon, province.name);
    if (inBounds) {
      return {
        province: province.name,
        city: null, // Bounding box can't determine city
        raw: { method: "bounding_box", lat, lon },
        source: "bounding_box",
      };
    }
  }

  return {
    province: null,
    city: null,
    raw: { method: "bounding_box", lat, lon, matched: false },
    source: "failed",
  };
}

/**
 * Map a Nominatim state string to our standard province name.
 */
function mapNominatimState(state: string): string | null {
  if (!state) return null;

  // Direct match
  if (NOMINATIM_STATE_TO_PROVINCE[state]) {
    return NOMINATIM_STATE_TO_PROVINCE[state];
  }

  // Case-insensitive match
  const lowerState = state.toLowerCase();
  for (const [key, value] of Object.entries(NOMINATIM_STATE_TO_PROVINCE)) {
    if (key.toLowerCase() === lowerState) {
      return value;
    }
  }

  // Partial match — check if state string contains a province name.
  // Only check one direction (state contains province) to avoid ambiguous
  // matches like "North" matching both "North West" and "Northern Cape".
  for (const province of SA_PROVINCES) {
    if (lowerState.includes(province.name.toLowerCase())) {
      return province.name;
    }
  }

  return null;
}

/**
 * Compute location confidence based on GPS results vs declared values.
 */
export function computeLocationConfidence(
  gpsProvince: string | null,
  declaredProvince: string,
  gpsCity: string | null,
  declaredCity: string,
  accuracyMeters: number
): LocationConfidence {
  // If geocoding failed entirely
  if (!gpsProvince) {
    return "none";
  }

  const provinceMatch = gpsProvince.toLowerCase() === declaredProvince.toLowerCase();

  if (!provinceMatch) {
    return "low";
  }

  // Province matches, check city + accuracy
  const cityMatch = gpsCity !== null && gpsCity.toLowerCase() === declaredCity.toLowerCase();

  if (cityMatch && accuracyMeters < GPS_ACCURACY_WARN_METERS) {
    return "high";
  }

  // Province matches but city doesn't or accuracy is poor
  return "medium";
}
