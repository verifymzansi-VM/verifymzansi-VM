import { describe, expect, it } from "vitest";
import { calculateSlaState, slaSortPriority, formatElapsed } from "./sla";

describe("calculateSlaState", () => {
  it('returns "on-track" for recently created high-severity report', () => {
    const now = new Date();
    const result = calculateSlaState(now, "high");
    expect(result.state).toBe("on-track");
    expect(result.slaHours).toBe(4);
    expect(result.hoursRemaining).toBeGreaterThan(3);
  });

  it('returns "on-track" for recently created standard report', () => {
    const now = new Date();
    const result = calculateSlaState(now, "standard");
    expect(result.state).toBe("on-track");
    expect(result.slaHours).toBe(24);
  });

  it('returns "breached" for overdue high-severity', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const result = calculateSlaState(fiveHoursAgo, "high");
    expect(result.state).toBe("breached");
    expect(result.hoursRemaining).toBe(0);
  });

  it('returns "at-risk" when within 25% remaining', () => {
    // Standard SLA = 24h. At-risk when < 6h remaining => > 18h elapsed
    const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000);
    const result = calculateSlaState(twentyHoursAgo, "standard");
    expect(result.state).toBe("at-risk");
  });

  it('returns "on-track" for resolved within SLA', () => {
    const created = new Date("2026-01-01T10:00:00Z");
    const resolved = new Date("2026-01-01T12:00:00Z"); // 2h later (< 4h SLA)
    const result = calculateSlaState(created, "high", resolved);
    expect(result.state).toBe("on-track");
  });

  it('returns "breached" for resolved past SLA', () => {
    const created = new Date("2026-01-01T10:00:00Z");
    const resolved = new Date("2026-01-01T16:00:00Z"); // 6h later (> 4h SLA)
    const result = calculateSlaState(created, "high", resolved);
    expect(result.state).toBe("breached");
  });
});

describe("slaSortPriority", () => {
  it("ranks breached highest", () => {
    expect(slaSortPriority("breached")).toBe(1);
    expect(slaSortPriority("at-risk")).toBe(2);
    expect(slaSortPriority("on-track")).toBe(3);
  });

  it("orders correctly for sorting", () => {
    expect(slaSortPriority("breached")).toBeLessThan(slaSortPriority("at-risk"));
  });
});

describe("formatElapsed", () => {
  it("formats days and hours", () => {
    expect(formatElapsed(26)).toBe("1d 2h");
    expect(formatElapsed(48)).toBe("2d 0h");
  });

  it("formats hours and minutes", () => {
    expect(formatElapsed(2.5)).toBe("2h 30m");
    expect(formatElapsed(1)).toBe("1h 0m");
  });

  it("formats minutes only for < 1 hour", () => {
    expect(formatElapsed(0.5)).toBe("30m");
    expect(formatElapsed(0)).toBe("0m");
  });
});
