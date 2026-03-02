"use client";

import { useRouter } from "next/navigation";
import { FlaggingQueueTable } from "./flagging-queue-table";
import type { DashboardReport } from "@/lib/utils/admin-queries";

export function DashboardReportsPanel({ reports }: { reports: DashboardReport[] }) {
  const router = useRouter();
  return (
    <FlaggingQueueTable
      reports={reports.map((r) => ({ ...r, description: r.description ?? undefined }))}
      onActionComplete={() => router.refresh()}
    />
  );
}
