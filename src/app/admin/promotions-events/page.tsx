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
  title: "Promotions & Events | Admin | VerifyMzansi",
};

export default async function AdminPromotionsEventsPage() {
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
      getPendingContent("PROMOTIONS_EVENTS"),
      getAreaReports("PROMOTIONS_EVENTS"),
      getRecentActivity(20, "PROMOTIONS_EVENTS"),
      getActionsToday("PROMOTIONS_EVENTS"),
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
        title="Promotions & Events"
        description="Manage content moderation and flagged reports for Promotions & Events."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Promotions & Events" }]}
      >
        <Badge variant="outline">PROMOTIONS_EVENTS</Badge>
      </PageHeader>

      <AreaAdminTabs
        area="PROMOTIONS_EVENTS"
        areaLabel="Promotions & Events"
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
