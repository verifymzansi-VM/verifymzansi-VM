import type { Report } from "@/types/database";
import type { ReportStatus } from "@/types/enums";

export type ReportStatusFilter = "all" | ReportStatus;

const OPEN_REPORT_STATUSES = new Set<ReportStatus>(["open", "in_progress"]);
const RESOLVED_REPORT_STATUSES = new Set<ReportStatus>(["resolved", "dismissed"]);

function isKnownReportStatus(value: unknown): value is ReportStatus {
  return (
    typeof value === "string" &&
    (OPEN_REPORT_STATUSES.has(value as ReportStatus) ||
      RESOLVED_REPORT_STATUSES.has(value as ReportStatus))
  );
}

export function countOpenReports(reports: ReadonlyArray<Pick<Report, "status">>): number {
  return reports.reduce((count, report) => {
    return OPEN_REPORT_STATUSES.has(report.status) ? count + 1 : count;
  }, 0);
}

export function filterReportsByStatus(
  reports: ReadonlyArray<Report>,
  filter: ReportStatusFilter
): Report[] {
  if (filter === "all") {
    return [...reports];
  }

  return reports.filter((report) => report.status === filter);
}

export function splitReportsByResolution(reports: ReadonlyArray<Report>): {
  open: Report[];
  resolved: Report[];
} {
  const open: Report[] = [];
  const resolved: Report[] = [];

  for (const report of reports) {
    const status = report.status;
    if (!isKnownReportStatus(status)) {
      continue;
    }

    if (OPEN_REPORT_STATUSES.has(status)) {
      open.push(report);
      continue;
    }

    resolved.push(report);
  }

  return { open, resolved };
}
