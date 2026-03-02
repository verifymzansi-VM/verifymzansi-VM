import { describe, expect, it } from "vitest";
import {
  formatZAR,
  formatZARShort,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatPhone,
} from "./format";

// ── formatZAR ───────────────────────────────────────────────────────────────

describe("formatZAR", () => {
  it("formats cents to rand with 2 decimals", () => {
    expect(formatZAR(26000)).toMatch(/R\s?260[\.,]00/);
    expect(formatZAR(0)).toMatch(/R\s?0[\.,]00/);
    expect(formatZAR(150)).toMatch(/R\s?1[\.,]50/);
  });
});

// ── formatZARShort ──────────────────────────────────────────────────────────

describe("formatZARShort", () => {
  it("formats round amounts without decimals", () => {
    expect(formatZARShort(26000)).toBe("R260");
    expect(formatZARShort(10000)).toBe("R100");
  });

  it("formats non-round amounts with decimals", () => {
    const result = formatZARShort(15050);
    expect(result).toMatch(/R150[\.,]50/);
  });
});

// ── formatDate ──────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats a date string", () => {
    const result = formatDate("2026-02-19T00:00:00Z");
    expect(result).toContain("2026");
    expect(result).toMatch(/Feb/);
  });

  it("formats a Date object", () => {
    const result = formatDate(new Date("2026-06-15T12:00:00Z"));
    expect(result).toContain("2026");
  });
});

// ── formatDateTime ──────────────────────────────────────────────────────────

describe("formatDateTime", () => {
  it("includes time component", () => {
    const result = formatDateTime("2026-02-19T14:30:00Z");
    expect(result).toContain("2026");
    // The time formatting depends on locale, just check it's longer than date-only
    expect(result.length).toBeGreaterThan(8);
  });
});

// ── formatRelativeTime ──────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  it('returns "just now" for very recent timestamps', () => {
    const now = new Date();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  it("returns minutes for timestamps minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(fiveMinAgo)).toBe("5 minutes ago");
  });

  it("returns hours for timestamps hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoHoursAgo)).toBe("2 hours ago");
  });

  it("returns singular forms", () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    expect(formatRelativeTime(oneMinAgo)).toBe("1 minute ago");

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(formatRelativeTime(oneHourAgo)).toBe("1 hour ago");
  });

  it("returns days for timestamps days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeDaysAgo)).toBe("3 days ago");
  });

  it("returns weeks for timestamps weeks ago", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoWeeksAgo)).toBe("2 weeks ago");
  });

  it("returns months for timestamps months ago", () => {
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeMonthsAgo)).toBe("3 months ago");
  });

  it("falls back to formatted date for very old timestamps", () => {
    const oldDate = new Date("2020-01-01T00:00:00Z");
    const result = formatRelativeTime(oldDate);
    expect(result).toContain("2020");
  });
});

// ── formatPhone ─────────────────────────────────────────────────────────────

describe("formatPhone", () => {
  it("formats +27 numbers", () => {
    expect(formatPhone("+27821234567")).toBe("+27 82 123 4567");
  });

  it("formats 0-prefix numbers", () => {
    expect(formatPhone("0821234567")).toBe("082 123 4567");
  });

  it("returns unrecognized numbers as-is", () => {
    expect(formatPhone("555-1234")).toBe("555-1234");
  });
});
