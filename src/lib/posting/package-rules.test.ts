import { describe, expect, it } from "vitest";
import {
  editAllowanceForDays,
  editLimitReachedMessage,
  editScreenRules,
  EVENT_EDIT_RULE,
  CURRENT_EDIT_RULE,
  SLOT_EDIT_ALLOWANCE,
} from "./package-rules";

it("states the live allowance over the post's life, by slot length (internal.edit_allowance)", () => {
  expect(SLOT_EDIT_ALLOWANCE).toBe(
    `up to ${editAllowanceForDays(30)}, ${editAllowanceForDays(90)} or ${editAllowanceForDays(180)} approved edits for a 30-, 90- or 180-day slot`
  );
  expect(SLOT_EDIT_ALLOWANCE).toBe(
    "up to 2, 6 or 12 approved edits for a 30-, 90- or 180-day slot"
  );
  expect(CURRENT_EDIT_RULE).toBe(
    "Each live post can have up to 2, 6 or 12 approved edits for a 30-, 90- or 180-day slot (a free post or an event: 2). It stays visible while we review an edit."
  );
  expect(CURRENT_EDIT_RULE).not.toMatch(/per 30 days|every 30 days/);
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

it("tells the edit screens the slot-based allowance, and events their 2 edits", () => {
  for (const kind of ["listing", "business", "event"] as const) {
    expect(editScreenRules(kind)).toEqual([CURRENT_EDIT_RULE]);
    expect(editLimitReachedMessage(kind)).not.toContain("price");
  }
  expect(editLimitReachedMessage("listing")).toBe(
    "This listing has used all its approved edits: up to 2, 6 or 12 approved edits for a 30-, 90- or 180-day slot (a free post: 2)."
  );
  expect(editLimitReachedMessage("business")).toContain(
    "This business profile has used all its approved edits"
  );
  expect(editLimitReachedMessage("event")).toBe("This event has used its 2 approved edits.");
});
