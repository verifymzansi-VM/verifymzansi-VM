import { describe, expect, it } from "vitest";
import {
  isPackageTerm,
  packageOnlineMaxSlots,
  packageQuote,
  packageTeamSize,
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
  it("pays online up to R10,000 for each term (100, 33 and 16 slots)", () => {
    expect([30, 90, 180].map((days) => packageOnlineMaxSlots(days as 30 | 90 | 180))).toEqual([
      100, 33, 16,
    ]);
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
  ] as const)("%s slots for %s days: %s", (slots, days, kind) => {
    expect(packageQuote(slots, days).kind).toBe(kind);
  });
  it("reads only whole numbers from the box", () => {
    expect(parseSlotCount("25")).toBe(25);
    expect(parseSlotCount(" 7 ")).toBe(7);
    for (const value of ["", "2.5", "-3", "1e2", "abc", "12345"])
      expect(parseSlotCount(value)).toBeNull();
  });
  it("knows the terms and the team included (you + 1, or you + 4 from 50 slots)", () => {
    expect(isPackageTerm(90)).toBe(true);
    expect(isPackageTerm(60)).toBe(false);
    expect(packageTeamSize(49)).toBe(2);
    expect(packageTeamSize(50)).toBe(5);
  });
});
