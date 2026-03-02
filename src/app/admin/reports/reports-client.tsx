"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaggingQueueTable } from "@/components/admin/flagging-queue-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  filterReportsByStatus,
  splitReportsByResolution,
  type ReportStatusFilter,
} from "@/lib/utils/reports";
import type { Report } from "@/types/database";

interface ReportsClientProps {
  reports: Report[];
}

const STATUS_FILTERS: readonly ReportStatusFilter[] = [
  "all",
  "open",
  "in_progress",
  "resolved",
  "dismissed",
];

export function ReportsClient({ reports }: ReportsClientProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>("all");

  const filtered = filterReportsByStatus(reports, statusFilter);
  const { open: openReports, resolved: resolvedReports } = splitReportsByResolution(filtered);

  return (
    <div className="space-y-4">
      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((s) => {
          const count = s === "all" ? reports.length : reports.filter((r) => r.status === s).length;
          return (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
              className="capitalize"
            >
              {s.replace("_", " ")}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {count}
              </Badge>
            </Button>
          );
        })}
      </div>

      {/* Open reports with SLA + enforcement */}
      {openReports.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Open Reports ({openReports.length})
          </h3>
          <FlaggingQueueTable reports={openReports} onActionComplete={() => router.refresh()} />
        </div>
      )}

      {/* Resolved/dismissed reports (read-only) */}
      {resolvedReports.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Resolved / Dismissed ({resolvedReports.length})
          </h3>
          <FlaggingQueueTable reports={resolvedReports} onActionComplete={() => router.refresh()} />
        </div>
      )}

      {filtered.length === 0 && (
        <p className="text-center py-8 text-muted-foreground">No reports match this filter.</p>
      )}
    </div>
  );
}
