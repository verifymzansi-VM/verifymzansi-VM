import { describe, expect, it } from "vitest";
import { endAfterDays, lostDaysReasonValid, lostDaysTermLabel, lostDaysValue } from "./lost-days";

describe("lost days helpers", () => {
  it("adds whole days to an end", () => {
    expect(endAfterDays("2026-12-22T08:00:00.000Z", 7)).toBe("2026-12-29T08:00:00.000Z");
    expect(endAfterDays("not a date", 7)).toBe("");
  });

  it("names a slot, a plan and a package", () => {
    expect(lostDaysTermLabel({ kind: "individual", slots: 1, renewals: 0 })).toBe(
      "Individual slot"
    );
    expect(lostDaysTermLabel({ kind: "individual", slots: 1, renewals: 1 })).toBe(
      "Individual slot (renewal queued)"
    );
    expect(lostDaysTermLabel({ kind: "individual", slots: 3, renewals: 2 })).toBe(
      "Individual plan of 3 slots (2 renewals queued)"
    );
    expect(lostDaysTermLabel({ kind: "package", slots: 12, renewals: 0 })).toBe(
      "Package of 12 slots"
    );
  });

  it("accepts 1 to 30 whole days", () => {
    expect(lostDaysValue("1")).toBe(1);
    expect(lostDaysValue("30")).toBe(30);
    for (const value of ["0", "31", "2.5", "", "seven"]) expect(lostDaysValue(value)).toBeNull();
  });

  it("accepts a one-line reason of 5 to 500 characters", () => {
    expect(lostDaysReasonValid("Down.")).toBe(true);
    expect(lostDaysReasonValid(` ${"a".repeat(500)} `)).toBe(true);
    expect(lostDaysReasonValid("abcd")).toBe(false);
    expect(lostDaysReasonValid("a".repeat(501))).toBe(false);
    expect(lostDaysReasonValid("two\nlines")).toBe(false);
  });
});
