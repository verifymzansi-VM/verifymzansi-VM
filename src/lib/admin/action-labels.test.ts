import { describe, expect, it } from "vitest";
import { actionTodayLabel } from "./action-labels";

describe("actionTodayLabel", () => {
  it.each([
    ["approve", "Content approved"],
    ["reject", "Content rejected"],
    ["dismiss", "Report dismissed"],
    ["resolve", "Report resolved"],
  ])("labels %s as %s", (key, label) => {
    expect(actionTodayLabel(key)).toBe(label);
  });

  it("never shows an unknown or inherited key", () => {
    expect(actionTodayLabel("request_changes")).toBe("Other action");
    expect(actionTodayLabel("constructor")).toBe("Other action");
  });
});
