import { describe, expect, it } from "vitest";
import {
  editAllowanceForDays,
  editLimitReachedMessage,
  editScreenRules,
  EVENT_EDIT_RULE,
  CURRENT_EDIT_RULE,
} from "./package-rules";

describe("package rules (DEC-28/29)", () => {
  it("gives 2 edits per started 30 days, matching internal.edit_allowance", () => {
    expect(editAllowanceForDays(7)).toBe(2);
    expect(editAllowanceForDays(30)).toBe(2);
    expect(editAllowanceForDays(31)).toBe(4);
    expect(editAllowanceForDays(90)).toBe(6);
    expect(editAllowanceForDays(180)).toBe(12);
    expect(editAllowanceForDays(0)).toBe(2);
    expect(editAllowanceForDays(Number.NaN)).toBe(2);
  });

  it("tells listings that price changes are still possible", () => {
    expect(editLimitReachedMessage("listing", "foundation")).toContain("change the price");
    expect(editLimitReachedMessage("business", "foundation")).not.toContain("price");
  });

  it("shows events their own edit rule", () => {
    expect(editScreenRules("event", "foundation")[0]).toBe(EVENT_EDIT_RULE);
    expect(editScreenRules("listing", "foundation")).toHaveLength(3);
  });
});

it("defaults current source screens and errors to the enforced two-edit policy", () => {
  for (const kind of ["listing", "business", "event"] as const) {
    expect(editScreenRules(kind)).toEqual([CURRENT_EDIT_RULE]);
    expect(editLimitReachedMessage(kind)).toContain("2 approved edits");
    expect(editLimitReachedMessage(kind)).not.toContain("price");
  }
});
