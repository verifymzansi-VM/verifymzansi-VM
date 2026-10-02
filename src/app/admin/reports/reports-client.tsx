"use client";

import { StatusFilterButtons } from "@/components/admin/status-filter-buttons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaggingQueueTable } from "@/components/admin/flagging-queue-table";
import {
  filterReportsByStatus,
  splitReportsByResolution,
  type ReportStatusFilter,
} from "@/lib/utils/reports";
import type { Report } from "@/types/database";

interface ReportsClientProps {
  reports: Report[];
  canEnforceDirectly?: boolean;
}

const STATUS_FILTERS: readonly ReportStatusFilter[] = [
  "all",
  "open",
  "in_progress",
  "resolved",
  "dismissed",
];

export function ReportsClient({ reports, canEnforceDirectly = false }: ReportsClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>("all");

  const filtered = filterReportsByStatus(reports, statusFilter);
  const { open: openReports, resolved: resolvedReports } = splitReportsByResolution(filtered);

  return (
    <div className="space-y-4">
      <StatusFilterButtons
        statuses={STATUS_FILTERS}
        value={statusFilter}
        onChange={setStatusFilter}
        rows={reports}
      />

      {/* Open reports with SLA + enforcement */}
      {openReports.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Open Reports ({openReports.length})
          </h3>
          <FlaggingQueueTable
            reports={openReports}
            onActionComplete={() => router.refresh()}
            canEnforceDirectly={canEnforceDirectly}
          />
        </div>
      )}

      {/* Resolved/dismissed reports (read-only) */}
      {resolvedReports.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Resolved / Dismissed ({resolvedReports.length})
          </h3>
          <FlaggingQueueTable
            reports={resolvedReports}
            onActionComplete={() => router.refresh()}
            readOnly
          />
        </div>
      )}

      {filtered.length === 0 && (
        <p className="text-center py-6 text-muted-foreground">No reports match this filter.</p>
      )}
    </div>
  );
}
