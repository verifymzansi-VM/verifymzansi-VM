import { redirect } from "next/navigation";
import { AreaAdminTabs } from "@/components/admin/area-admin-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { isStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import {
  getActionsToday,
  getAreaReports,
  getPendingContent,
  getPendingVerificationGroups,
  getRecentActivity,
  type DashboardReport,
} from "@/lib/utils/admin-queries";
import { calculateSlaState } from "@/lib/utils/sla";
import type { MarketplaceArea } from "@/types/enums";

interface AreaAdminPageConfig {
  area: MarketplaceArea;
  areaLabel: string;
  description: string;
}

function fulfilledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

export async function AreaAdminPage({ area, areaLabel, description }: AreaAdminPageConfig) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isStaff(user)) {
    redirect("/dashboard");
  }

  const settled = await Promise.allSettled([
    getPendingVerificationGroups(),
    getPendingContent(area),
    getAreaReports(area),
    getRecentActivity(20, area),
    getActionsToday(area),
  ]);

  const pendingVerifications = fulfilledValue(settled[0], []);
  const pendingContent = fulfilledValue(settled[1], []);
  const reports = fulfilledValue(settled[2], []);
  const activity = fulfilledValue(settled[3], []);
  const actionsToday = fulfilledValue(settled[4], {});
  const pendingVerificationCount = pendingVerifications.reduce(
    (count, group) => count + group.steps.length,
    0
  );

  const highSeverityOverdue = reports.filter((report: DashboardReport) => {
    if (report.severity !== "high") return false;
    const sla = calculateSlaState(report.created_at, "high");
    return sla.state === "breached";
  }).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={areaLabel}
        description={description}
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: areaLabel }]}
      >
        <Badge variant="outline">{area}</Badge>
      </PageHeader>

      <AreaAdminTabs
        area={area}
        areaLabel={areaLabel}
        pendingVerifications={pendingVerifications}
        pendingContent={pendingContent}
        reports={reports}
        activityEntries={activity}
        overviewStats={{
          pendingVerificationCount,
          pendingFlagCount: reports.length,
          highSeverityOverdue,
          pendingContentCount: pendingContent.length,
          actionsToday,
        }}
      />
    </div>
  );
}
