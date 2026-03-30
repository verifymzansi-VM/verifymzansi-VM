import { describe, expect, it } from "vitest";
import { addDaysToDateInput, getDefaultEventDates } from "@/lib/post-drafts/defaults";

describe("post draft defaults", () => {
  it("uses today and +7 days when event dates are empty", () => {
    const defaults = getDefaultEventDates("", "", new Date("2026-03-30T12:00:00Z"));

    expect(defaults.startDate).toBe("2026-03-30");
    expect(defaults.endDate).toBe("2026-04-06");
  });

  it("keeps start date and derives end date when only end is missing", () => {
    const defaults = getDefaultEventDates("2026-04-10", "");

    expect(defaults.startDate).toBe("2026-04-10");
    expect(defaults.endDate).toBe("2026-04-17");
  });

  it("does not override explicit start and end dates", () => {
    const defaults = getDefaultEventDates("2026-05-01", "2026-05-03");

    expect(defaults.startDate).toBe("2026-05-01");
    expect(defaults.endDate).toBe("2026-05-03");
  });

  it("adds days across month boundaries", () => {
    expect(addDaysToDateInput("2026-01-28", 7)).toBe("2026-02-04");
  });
});
