import { describe, expect, it } from "vitest";
import { getOpenStatus, parseIntervals } from "./open-status";

/** A moment in South African time (UTC+2, no daylight saving). */
function sa(isoLocal: string) {
  return new Date(`${isoLocal}+02:00`);
}

// 2026-10-05 is a Monday; 2026-10-10 a Saturday; 2026-10-11 a Sunday.
describe("getOpenStatus", () => {
  const hours = { Mon_Fri: "08:00-17:00", Sat: "9am - 1pm", Sun: "Closed" };

  it("is open inside weekday hours and says when it closes", () => {
    expect(getOpenStatus(hours, sa("2026-10-05T10:30:00"))).toEqual({
      state: "open",
      label: "Open now, closes 17:00",
    });
  });

  it("is closed before opening and says when it opens", () => {
    expect(getOpenStatus(hours, sa("2026-10-05T07:15:00"))).toEqual({
      state: "closed",
      label: "Closed, opens 08:00",
    });
  });

  it("is closed after hours", () => {
    expect(getOpenStatus(hours, sa("2026-10-05T17:00:00")).label).toBe("Closed now");
  });

  it("reads am/pm Saturday hours", () => {
    expect(getOpenStatus(hours, sa("2026-10-10T12:59:00")).state).toBe("open");
    expect(getOpenStatus(hours, sa("2026-10-10T13:00:00")).state).toBe("closed");
  });

  it("reports closed days", () => {
    expect(getOpenStatus(hours, sa("2026-10-11T11:00:00"))).toEqual({
      state: "closed",
      label: "Closed today",
    });
  });

  it("uses South African time regardless of the server clock", () => {
    // 06:30 UTC is 08:30 in Johannesburg.
    expect(getOpenStatus(hours, new Date("2026-10-05T06:30:00Z")).state).toBe("open");
  });

  it("handles split shifts", () => {
    const split = { Mon_Fri: "08:00-12:00, 13:00-17:00" };
    expect(getOpenStatus(split, sa("2026-10-05T12:30:00")).label).toBe("Closed, opens 13:00");
    expect(getOpenStatus(split, sa("2026-10-05T13:30:00")).state).toBe("open");
  });

  it("keeps overnight hours open after midnight", () => {
    const late = { Mon_Fri: "18:00-02:00", Sat: "Closed" };
    expect(getOpenStatus(late, sa("2026-10-05T23:00:00")).label).toBe("Open now, closes 02:00");
    // Saturday 01:00 is still Friday night's shift.
    expect(getOpenStatus(late, sa("2026-10-10T01:00:00")).state).toBe("open");
    expect(getOpenStatus(late, sa("2026-10-10T03:00:00")).label).toBe("Closed today");
  });

  it("supports appointments and 24-hour businesses", () => {
    expect(getOpenStatus({ Mon_Fri: "By appointment" }, sa("2026-10-05T10:00:00")).state).toBe(
      "appointment"
    );
    expect(getOpenStatus({ Mon_Fri: "Open 24 hours" }, sa("2026-10-05T03:00:00")).state).toBe(
      "open"
    );
  });

  it("never claims open for text it cannot read or missing days", () => {
    expect(getOpenStatus({ Mon_Fri: "Ask us" }, sa("2026-10-05T10:00:00")).state).toBe("unknown");
    expect(getOpenStatus({ Sat: "09:00-13:00" }, sa("2026-10-05T10:00:00")).state).toBe("unknown");
    expect(getOpenStatus(null).state).toBe("unknown");
  });
});

describe("parseIntervals", () => {
  it("rejects impossible times", () => {
    expect(parseIntervals("25:00-26:00")).toEqual([]);
    expect(parseIntervals("13pm-2pm")).toEqual([]);
  });

  it("applies the end meridiem to a bare start", () => {
    expect(parseIntervals("8 - 5pm")).toEqual([{ start: 480, end: 1020 }]);
  });
});
