export interface Province {
  name: string;
  code: string;
  cities: string[];
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
  const province = SA_PROVINCES.find((p) => p.name === provinceName);
  return province?.cities ?? [];
}
