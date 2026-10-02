import { describe, expect, it } from "vitest";
import { formatEventWhen } from "./event-facts";

describe("formatEventWhen", () => {
  it("shows the day and time range in South African time", () => {
    // 16:00 UTC is 18:00 in Johannesburg.
    expect(formatEventWhen("2026-10-31T16:00:00Z", "2026-10-31T21:00:00Z")).toBe(
      "Sat 31 Oct, 18:00 – 23:00"
    );
  });

  it("names both days when the event runs past midnight", () => {
    expect(formatEventWhen("2026-10-31T16:00:00Z", "2026-11-01T00:30:00Z")).toBe(
      "Sat 31 Oct, 18:00 – Sun 1 Nov, 02:30"
    );
  });

  it("leaves out a time that was never set (midnight) and an end before the start", () => {
    expect(formatEventWhen("2026-10-30T22:00:00Z", null)).toBe("Sat 31 Oct");
    expect(formatEventWhen("2026-10-31T16:00:00Z", "2026-10-31T10:00:00Z")).toBe(
      "Sat 31 Oct, 18:00"
    );
    expect(formatEventWhen(null, null)).toBeNull();
    expect(formatEventWhen("not a date", null)).toBeNull();
  });
});
