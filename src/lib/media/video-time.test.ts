import { describe, expect, it } from "vitest";
import { describeVideoProgress, formatVideoTime } from "./video-time";

describe("video time label", () => {
  it("shows minutes and two-digit seconds", () => {
    expect(formatVideoTime(0)).toBe("0:00");
    expect(formatVideoTime(7.9)).toBe("0:07");
    expect(formatVideoTime(12)).toBe("0:12");
    expect(formatVideoTime(59.99)).toBe("0:59");
    expect(formatVideoTime(60)).toBe("1:00");
    expect(formatVideoTime(119.5)).toBe("1:59");
    expect(formatVideoTime(600)).toBe("10:00");
  });

  it("adds hours past an hour", () => {
    expect(formatVideoTime(3600)).toBe("1:00:00");
    expect(formatVideoTime(3723)).toBe("1:02:03");
  });

  it("shows 0:00 for a length the browser does not know yet", () => {
    expect(formatVideoTime(Number.NaN)).toBe("0:00");
    expect(formatVideoTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatVideoTime(-3)).toBe("0:00");
  });

  it("states where playback is and the video's length", () => {
    expect(describeVideoProgress(12, 45)).toBe("0:12 of 0:45");
  });
});
