export interface Province {
  name: string;
  code: string;
  cities: string[];
}

const SA_PROVINCE_ALIASES: Record<string, string> = {
  "eastern cape": "Eastern Cape",
  ec: "Eastern Cape",
  "free state": "Free State",
  fs: "Free State",
  gauteng: "Gauteng",
  gp: "Gauteng",
  gt: "Gauteng",
  "kwazulu-natal": "KwaZulu-Natal",
  "kwazulu natal": "KwaZulu-Natal",
  kzn: "KwaZulu-Natal",
  limpopo: "Limpopo",
  lp: "Limpopo",
  mpumalanga: "Mpumalanga",
  mp: "Mpumalanga",
  "north west": "North West",
  nw: "North West",
  "northern cape": "Northern Cape",
  nc: "Northern Cape",
  "western cape": "Western Cape",
  wc: "Western Cape",
};

function normalizeLocationLookupValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[()]/g, " ")
    .replace(/[^a-zA-Z0-9\s-]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getCityAliasCandidates(cityName: string): string[] {
  const aliases = new Set<string>();
  const trimmedCity = cityName.trim();

  if (!trimmedCity) {
    return [];
  }

  aliases.add(trimmedCity);

  const parentheticalMatches = [...trimmedCity.matchAll(/\(([^)]+)\)/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  const withoutParenthetical = trimmedCity
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutParenthetical) {
    aliases.add(withoutParenthetical);
  }

  for (const alias of parentheticalMatches) {
    aliases.add(alias);
  }

  return [...aliases];
}

const CITY_ALIAS_LOOKUP = new Map<string, Map<string, string>>();

function getProvinceCityAliasLookup(provinceName: string): Map<string, string> {
  const cached = CITY_ALIAS_LOOKUP.get(provinceName);
  if (cached) {
    return cached;
  }

  const province = SA_PROVINCES.find((entry) => entry.name === provinceName);
  const lookup = new Map<string, string>();

  for (const city of province?.cities ?? []) {
    for (const alias of getCityAliasCandidates(city)) {
      lookup.set(normalizeLocationLookupValue(alias), city);
    }
  }

  CITY_ALIAS_LOOKUP.set(provinceName, lookup);
  return lookup;
}

export const SA_PROVINCES: Province[] = [
  {
    name: "Gauteng",
    code: "GP",
    cities: [
      "Johannesburg",
      "Pretoria",
      "Centurion",
      "Sandton",
      "Soweto",
      "Midrand",
      "Randburg",
      "Roodepoort",
      "Boksburg",
      "Benoni",
      "Kempton Park",
      "Germiston",
      "Springs",
      "Alberton",
      "Krugersdorp",
      "Vereeniging",
      "Vanderbijlpark",
    ],
  },
  {
    name: "Western Cape",
    code: "WC",
    cities: [
      "Cape Town",
      "Stellenbosch",
      "Paarl",
      "George",
      "Knysna",
      "Mossel Bay",
      "Worcester",
      "Hermanus",
      "Franschhoek",
      "Somerset West",
      "Bellville",
      "Durbanville",
      "Malmesbury",
    ],
  },
  {
    name: "KwaZulu-Natal",
    code: "KZN",
    cities: [
      "Durban",
      "Pietermaritzburg",
      "Richards Bay",
      "Newcastle",
      "Umhlanga",
      "Ballito",
      "Pinetown",
      "Chatsworth",
      "Ladysmith",
      "Port Shepstone",
      "Margate",
      "Scottburgh",
    ],
  },
  {
    name: "Eastern Cape",
    code: "EC",
    cities: [
      "Port Elizabeth (Gqeberha)",
      "East London",
      "Mthatha",
      "Bhisho",
      "Grahamstown (Makhanda)",
      "Queenstown",
      "King Williams Town",
      "Cradock",
      "Uitenhage",
    ],
  },
  {
    name: "Free State",
    code: "FS",
    cities: [
      "Bloemfontein",
      "Welkom",
      "Kroonstad",
      "Bethlehem",
      "Sasolburg",
      "Parys",
      "Virginia",
      "Phuthaditjhaba",
    ],
  },
  {
    name: "Mpumalanga",
    code: "MP",
    cities: [
      "Mbombela (Nelspruit)",
      "Witbank (Emalahleni)",
      "Secunda",
      "Middelburg",
      "White River",
      "Barberton",
      "Standerton",
      "Ermelo",
    ],
  },
  {
    name: "Limpopo",
    code: "LP",
    cities: [
      "Polokwane",
      "Tzaneen",
      "Mokopane",
      "Musina",
      "Louis Trichardt",
      "Thohoyandou",
      "Phalaborwa",
      "Lephalale",
    ],
  },
  {
    name: "North West",
    code: "NW",
    cities: [
      "Rustenburg",
      "Mahikeng",
      "Potchefstroom (Tlokwe)",
      "Klerksdorp",
      "Brits",
      "Sun City",
      "Hartbeespoort",
      "Lichtenburg",
    ],
  },
  {
    name: "Northern Cape",
    code: "NC",
    cities: ["Kimberley", "Upington", "Springbok", "De Aar", "Kuruman", "Kathu"],
  },
];

/**
 * Coarse lat/lon bounding boxes for South Africa's 9 provinces.
 * Used for GPS-vs-declared province mismatch detection without
 * any third-party geocoding calls.
 * Format: [latMin, latMax, lonMin, lonMax]
 */
export const GPS_PROVINCE_BOUNDS: Record<string, [number, number, number, number]> = {
  Gauteng: [-26.8, -25.3, 27.4, 29.0],
  "Western Cape": [-34.8, -31.4, 17.9, 23.0],
  "KwaZulu-Natal": [-31.5, -26.8, 29.2, 32.9],
  "Eastern Cape": [-34.1, -30.6, 24.9, 30.5],
  "Free State": [-30.7, -26.8, 24.8, 30.1],
  Mpumalanga: [-27.0, -24.3, 29.0, 32.9],
  Limpopo: [-25.0, -22.1, 26.2, 31.8],
  "North West": [-28.0, -24.9, 22.5, 28.4],
  "Northern Cape": [-32.9, -26.7, 16.5, 25.2],
};

/**
 * Returns whether a GPS coordinate falls within the declared province's
 * bounding box. Returns null if the province has no bounds defined.
 */
export function isCoordInProvince(lat: number, lon: number, provinceName: string): boolean | null {
  const bounds = GPS_PROVINCE_BOUNDS[provinceName];
  if (!bounds) return null;
  const [latMin, latMax, lonMin, lonMax] = bounds;
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

export function normalizeProvinceName(provinceName: string | null | undefined): string | null {
  if (!provinceName) {
    return null;
  }

  const trimmedProvince = provinceName.trim();
  if (!trimmedProvince) {
    return null;
  }

  const normalizedProvince = normalizeLocationLookupValue(trimmedProvince);

  return (
    SA_PROVINCE_ALIASES[normalizedProvince] ??
    SA_PROVINCES.find(
      (province) => normalizeLocationLookupValue(province.name) === normalizedProvince
    )?.name ??
    null
  );
}

export function resolveCityName(
  provinceName: string | null | undefined,
  cityName: string | null | undefined
): string | null {
  if (!cityName) {
    return null;
  }

  const canonicalProvince = normalizeProvinceName(provinceName);
  const trimmedCity = cityName.trim();

  if (!canonicalProvince || !trimmedCity) {
    return null;
  }

  const aliasLookup = getProvinceCityAliasLookup(canonicalProvince);
  return aliasLookup.get(normalizeLocationLookupValue(trimmedCity)) ?? null;
}

export function citiesMatch(
  provinceName: string | null | undefined,
  firstCity: string | null | undefined,
  secondCity: string | null | undefined
): boolean {
  if (!firstCity || !secondCity) {
    return false;
  }

  const canonicalProvince = normalizeProvinceName(provinceName);
  if (canonicalProvince) {
    const firstResolved = resolveCityName(canonicalProvince, firstCity);
    const secondResolved = resolveCityName(canonicalProvince, secondCity);

    if (firstResolved && secondResolved) {
      return firstResolved === secondResolved;
    }
  }

  return normalizeLocationLookupValue(firstCity) === normalizeLocationLookupValue(secondCity);
}

/**
 * Get all province names.
 */
export function getProvinceNames(): string[] {
  return SA_PROVINCES.map((p) => p.name);
}

/**
 * Get cities for a province by name.
 */
export function getCitiesForProvince(provinceName: string): string[] {
  const canonicalProvince = normalizeProvinceName(provinceName) ?? provinceName;
  const province = SA_PROVINCES.find((p) => p.name === canonicalProvince);
  return province?.cities ?? [];
}

/** Re-export town helper for single-import convenience. */
export { getTownsForCity } from "./sa-towns";
