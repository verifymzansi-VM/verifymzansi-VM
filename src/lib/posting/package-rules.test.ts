import { describe, expect, it } from "vitest";
import {
  editAllowanceForDays,
  editLimitReachedMessage,
  editScreenRules,
  EDIT_RULE,
  EVENT_EDIT_RULE,
  CURRENT_EDIT_RULE,
} from "./package-rules";

it("states the live edit allowance on the pricing page (2 per 30 days, not 2 in total)", () => {
  expect(EDIT_RULE).toContain(
    `30 days: ${editAllowanceForDays(30)}, 90 days: ${editAllowanceForDays(90)}, 180 days: ${editAllowanceForDays(180)}`
  );
  expect(EDIT_RULE).not.toMatch(/up to 2 approved edits/i);
});

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
