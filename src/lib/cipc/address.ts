import { normalizeProvinceName, resolveCityName } from "@/lib/constants/sa-provinces";
import { getTownsForCity } from "@/lib/constants/sa-towns";

export type RegisteredOffice = {
  streetLines: string[];
  suburb: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  /** False when the city is not in our list; it is kept as printed. */
  cityKnown: boolean;
};

/** "KWA-ZULU NATAL" → "Kwa-Zulu Natal"; keeps short tokens like "CBD" upper-case. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s\-/'’(])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/\b(Cbd|Po)\b/g, (w) => w.toUpperCase());
}

/**
 * Splits the "ADDRESS OF REGISTERED OFFICE" lines from a CIPC document,
 * reading bottom-up: postal code, province, city, then suburb; whatever is
 * left above is the street address.
 */
export function parseRegisteredOffice(rawLines: string[]): RegisteredOffice {
  const lines = rawLines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  let postalCode: string | null = null;
  if (lines.length && /^\d{4}$/.test(lines[lines.length - 1])) {
    postalCode = lines.pop() ?? null;
  }

  let province: string | null = null;
  if (lines.length) {
    province = normalizeProvinceName(lines[lines.length - 1]);
    if (province) lines.pop();
  }

  let city: string | null = null;
  let cityKnown = false;
  if (lines.length) {
    const printed = lines.pop() as string;
    const resolved = province ? resolveCityName(province, printed) : null;
    city = resolved ?? titleCase(printed);
    cityKnown = resolved !== null;
  }

  // Prefer a line we recognise as a town of that city; otherwise the line
  // just above the city is the suburb.
  const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const towns = province && cityKnown && city ? getTownsForCity(province, city) : [];
  const townIndex = lines.findIndex((l) => towns.some((t) => key(t) === key(l)));
  let suburb: string | null = null;
  if (townIndex >= 0) {
    suburb = towns.find((t) => key(t) === key(lines[townIndex])) ?? null;
    lines.splice(townIndex, 1);
  } else if (lines.length) {
    suburb = titleCase(lines.pop() as string);
  }

  return {
    streetLines: lines.map(titleCase),
    suburb,
    city,
    province,
    postalCode,
    cityKnown,
  };
}

/** Public line: suburb, city, province — the street is shown only by owner choice. */
export function registeredOfficeSummary(
  office: Pick<RegisteredOffice, "suburb" | "city" | "province">
): string {
  return [office.suburb, office.city, office.province].filter(Boolean).join(", ");
}
