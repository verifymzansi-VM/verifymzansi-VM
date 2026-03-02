import { describe, expect, it } from "vitest";
import {
  countOpenReports,
  filterReportsByStatus,
  splitReportsByResolution,
  type ReportStatusFilter,
} from "./reports";
import type { Report } from "@/types/database";

function createReport(id: string, status: Report["status"]): Report {
  return {
    id,
    target_id: `target-${id}`,
    target_type: "listing",
    area: "MZANSI_MARKET",
    category: "scam",
    severity: "standard",
    description: `report-${id}`,
    screenshot_url: null,
    reporter_user_id: null,
    reporter_ip_hash: "hash",
    status,
    assigned_to: null,
    resolved_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("reports helpers", () => {
  it("handles mixed report statuses", () => {
    const reports = [
      createReport("1", "open"),
      createReport("2", "in_progress"),
      createReport("3", "resolved"),
      createReport("4", "dismissed"),
    ];

    expect(countOpenReports(reports)).toBe(2);

    const filtered = filterReportsByStatus(reports, "open" satisfies ReportStatusFilter);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.status).toBe("open");

    const split = splitReportsByResolution(reports);
    expect(split.open).toHaveLength(2);
    expect(split.resolved).toHaveLength(2);
  });

  it("handles empty report lists", () => {
    expect(countOpenReports([])).toBe(0);
    expect(filterReportsByStatus([], "all")).toEqual([]);
    expect(splitReportsByResolution([])).toEqual({ open: [], resolved: [] });
  });

  it("does not inflate open counts for malformed statuses", () => {
    const malformed = createReport("5", "unexpected" as unknown as Report["status"]);

    expect(() => countOpenReports([malformed])).not.toThrow();
    expect(() => splitReportsByResolution([malformed])).not.toThrow();
    expect(countOpenReports([malformed])).toBe(0);

    const split = splitReportsByResolution([malformed]);
    expect(split.open).toHaveLength(0);
    expect(split.resolved).toHaveLength(0);
  });
});
