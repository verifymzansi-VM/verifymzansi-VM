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
  title: "Mzansi Market | Admin | VerifyMzansi",
};

export default async function AdminMzansiMarketPage() {
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
      getPendingContent("MZANSI_MARKET"),
      getAreaReports("MZANSI_MARKET"),
      getRecentActivity(20, "MZANSI_MARKET"),
      getActionsToday("MZANSI_MARKET"),
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
        title="Mzansi Market"
        description="Manage verification, content moderation, and flagged reports for Mzansi Market."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Mzansi Market" }]}
      >
        <Badge variant="outline">MZANSI_MARKET</Badge>
      </PageHeader>

      <AreaAdminTabs
        area="MZANSI_MARKET"
        areaLabel="Mzansi Market"
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
