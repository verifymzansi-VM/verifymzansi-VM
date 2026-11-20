import { describe, expect, it } from "vitest";
import {
  isPackageTerm,
  packageAddQuote,
  packageOnlineMaxSlots,
  packageQuote,
  packageTotalCents,
  parseSlotCount,
} from "./slot-packages";

describe("Multi-listing package rules (P4a)", () => {
  it("prices R100 per slot per 30 days, in whole rands", () => {
    expect(packageTotalCents(5, 30)).toBe(50_000);
    expect(packageTotalCents(25, 90)).toBe(750_000);
    expect(packageTotalCents(100, 30)).toBe(1_000_000);
    expect(packageTotalCents(16, 180)).toBe(960_000);
  });
  it("pays online up to Ozow's maximum for each term, and at most 100 slots", () => {
    const terms = [30, 90, 180] as const;
    // R1,300 (today's maximum): 13, 4 and 2 slots.
    expect(terms.map((days) => packageOnlineMaxSlots(days, 130_000))).toEqual([13, 4, 2]);
    expect(terms.map((days) => packageOnlineMaxSlots(days, 1_000_000))).toEqual([100, 33, 16]);
    // Unknown limit: only the 100-slot rule (the database still applies the limit).
    expect(terms.map((days) => packageOnlineMaxSlots(days))).toEqual([100, 100, 100]);
  });
  it.each([
    [null, 30, "invalid"],
    [0, 30, "invalid"],
    [4, 30, "too_small"],
    [5, 30, "online"],
    [100, 30, "online"],
    [101, 30, "invoice"],
    [33, 90, "online"],
    [34, 90, "invoice"],
    [16, 180, "online"],
    [17, 180, "invoice"],
    [250, 30, "invoice"],
    [251, 30, "too_large"],
  ] as const)("%s slots for %s days: %s (limit R10,000)", (slots, days, kind) => {
    expect(packageQuote(slots, days, 1_000_000).kind).toBe(kind);
  });
  it.each([
    [13, 30, "online"],
    [14, 30, "invoice"],
    [5, 90, "invoice"],
    [5, 180, "invoice"],
  ] as const)("%s slots for %s days: %s (limit R1,300)", (slots, days, kind) => {
    expect(packageQuote(slots, days, 130_000).kind).toBe(kind);
  });
  it("reads only whole numbers from the box", () => {
    expect(parseSlotCount("25")).toBe(25);
    expect(parseSlotCount(" 7 ")).toBe(7);
    for (const value of ["", "2.5", "-3", "1e2", "abc", "12345"])
      expect(parseSlotCount(value)).toBeNull();
  });
  it("knows the terms", () => {
    expect(isPackageTerm(90)).toBe(true);
    expect(isPackageTerm(60)).toBe(false);
  });
});

describe("Adding slots part-way (P4b)", () => {
  // 25 slots, 38 whole days left: one added slot costs R126.67.
  const offer = {
    unitPriceCents: 12_667,
    places: 25,
    maxSlots: 225,
    onlineOpen: true,
    invoiceOpen: true,
  };
  it("costs n times one slot's price for the days left", () => {
    expect(packageAddQuote(5, offer, 130_000)).toEqual({ kind: "online", totalCents: 63_335 });
    expect(packageAddQuote(1, offer, null)).toEqual({ kind: "online", totalCents: 12_667 });
  });
  it("goes by invoice above Ozow's maximum or 100 slots in all", () => {
    expect(packageAddQuote(20, offer, 130_000)).toEqual({ kind: "invoice", totalCents: 253_340 });
    expect(packageAddQuote(76, { ...offer, unitPriceCents: 100 }, null)).toEqual({
      kind: "invoice",
      totalCents: 7_600,
    });
    expect(packageAddQuote(75, { ...offer, unitPriceCents: 100 }, null).kind).toBe("online");
  });
  it("refuses nothing typed, zero, and more than the package can hold", () => {
    expect(packageAddQuote(null, offer, null)).toEqual({ kind: "invalid" });
    expect(packageAddQuote(0, offer, null)).toEqual({ kind: "invalid" });
    expect(packageAddQuote(226, offer, null)).toEqual({ kind: "too_large", maxSlots: 225 });
  });
  it("is closed when that way is not open any more", () => {
    expect(packageAddQuote(20, { ...offer, invoiceOpen: false }, 130_000).kind).toBe("closed");
    expect(packageAddQuote(2, { ...offer, onlineOpen: false }, 130_000).kind).toBe("closed");
  });
});
