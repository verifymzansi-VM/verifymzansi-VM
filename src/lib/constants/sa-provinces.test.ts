import { describe, it, expect } from "vitest";
import {
  SA_PROVINCES,
  citiesMatch,
  getProvinceNames,
  getCitiesForProvince,
  normalizeProvinceName,
  resolveCityName,
} from "./sa-provinces";

describe("sa-provinces", () => {
  it("contains exactly 9 provinces", () => {
    expect(SA_PROVINCES).toHaveLength(9);
  });

  it("every province has name, code, and cities", () => {
    for (const province of SA_PROVINCES) {
      expect(province.name).toBeTruthy();
      expect(province.code).toBeTruthy();
      expect(province.code.length).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(province.cities)).toBe(true);
      expect(province.cities.length).toBeGreaterThan(0);
    }
  });

  it("includes all 9 SA provinces by name", () => {
    const names = SA_PROVINCES.map((p) => p.name);
    expect(names).toContain("Gauteng");
    expect(names).toContain("Western Cape");
    expect(names).toContain("KwaZulu-Natal");
    expect(names).toContain("Eastern Cape");
    expect(names).toContain("Free State");
    expect(names).toContain("Mpumalanga");
    expect(names).toContain("Limpopo");
    expect(names).toContain("North West");
    expect(names).toContain("Northern Cape");
  });

  it("province codes are unique", () => {
    const codes = SA_PROVINCES.map((p) => p.code);
    expect(new Set(codes).size).toBe(9);
  });

  describe("getProvinceNames", () => {
    it("returns all 9 province names", () => {
      const names = getProvinceNames();
      expect(names).toHaveLength(9);
      expect(names).toContain("Gauteng");
      expect(names).toContain("Northern Cape");
    });
  });

  describe("getCitiesForProvince", () => {
    it("returns cities for Gauteng", () => {
      const cities = getCitiesForProvince("Gauteng");
      expect(cities.length).toBeGreaterThan(0);
      expect(cities).toContain("Johannesburg");
      expect(cities).toContain("Pretoria");
    });

    it("returns cities for Western Cape", () => {
      const cities = getCitiesForProvince("Western Cape");
      expect(cities).toContain("Cape Town");
      expect(cities).toContain("Stellenbosch");
    });

    it("returns empty array for unknown province", () => {
      const cities = getCitiesForProvince("Narnia");
      expect(cities).toEqual([]);
    });

    it("accepts province aliases when fetching cities", () => {
      const cities = getCitiesForProvince("kzn");
      expect(cities).toContain("Durban");
      expect(cities).toContain("Richards Bay");
    });
  });

  describe("normalizeProvinceName", () => {
    it("maps common province aliases to canonical names", () => {
      expect(normalizeProvinceName("kzn")).toBe("KwaZulu-Natal");
      expect(normalizeProvinceName("western cape")).toBe("Western Cape");
    });
  });

  describe("resolveCityName", () => {
    it("maps parenthetical city aliases to canonical stored values", () => {
      expect(resolveCityName("Eastern Cape", "Gqeberha")).toBe("Port Elizabeth (Gqeberha)");
      expect(resolveCityName("Mpumalanga", "Nelspruit")).toBe("Mbombela (Nelspruit)");
    });
  });

  describe("citiesMatch", () => {
    it("treats canonical city aliases as equivalent within a province", () => {
      expect(citiesMatch("Eastern Cape", "Gqeberha", "Port Elizabeth (Gqeberha)")).toBe(true);
      expect(citiesMatch("Mpumalanga", "Mbombela (Nelspruit)", "Nelspruit")).toBe(true);
    });

    it("does not match different cities within the same province", () => {
      expect(citiesMatch("Gauteng", "Johannesburg", "Pretoria")).toBe(false);
    });
  });
});
