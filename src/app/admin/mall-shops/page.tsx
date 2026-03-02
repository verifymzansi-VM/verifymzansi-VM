import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { AreaAdminTabs } from "@/components/admin/area-admin-tabs";
import {
  getPendingVerifications,
  getPendingContent,
  getAreaReports,
  getRecentActivity,
  getActionsToday,
  type DashboardReport,
} from "@/lib/utils/admin-queries";
import { calculateSlaState } from "@/lib/utils/sla";
import { isModeratorOrAdmin } from "@/lib/auth/roles";

export const metadata = {
  title: "Mall Shops | Admin | VerifyMzansi",
};

export default async function AdminMallShopsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isModeratorOrAdmin(user)) {
    redirect("/dashboard");
  }

  const [pendingVerifications, pendingContent, reports, activity, actionsToday] = await Promise.all(
    [
      getPendingVerifications(),
      getPendingContent("MALL_SHOPS"),
      getAreaReports("MALL_SHOPS"),
      getRecentActivity(20, "MALL_SHOPS"),
      getActionsToday("MALL_SHOPS"),
    ]
  );

  const highSeverityOverdue = reports.filter((r: DashboardReport) => {
    if (r.severity !== "high") return false;
    const sla = calculateSlaState(r.created_at, "high");
    return sla.state === "breached";
  }).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mall Shops"
        description="Manage verification, content moderation, and flagged reports for Mall Shops."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Mall Shops" }]}
      >
        <Badge variant="outline">MALL_SHOPS</Badge>
      </PageHeader>

      <AreaAdminTabs
        area="MALL_SHOPS"
        areaLabel="Mall Shops"
        pendingVerifications={pendingVerifications}
        pendingContent={pendingContent}
        reports={reports}
        activityEntries={activity}
        overviewStats={{
          pendingVerificationCount: pendingVerifications.length,
          pendingFlagCount: reports.length,
          highSeverityOverdue,
          pendingContentCount: pendingContent.length,
          actionsToday,
        }}
      />
    </div>
  );
}
