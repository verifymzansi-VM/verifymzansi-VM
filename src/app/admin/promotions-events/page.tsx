import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { AreaAdminTabs } from "@/components/admin/area-admin-tabs";
import {
  getPendingVerificationGroups,
  getPendingContent,
  getAreaReports,
  getRecentActivity,
  getActionsToday,
  type DashboardReport,
} from "@/lib/utils/admin-queries";
import { calculateSlaState } from "@/lib/utils/sla";
import { isStaff } from "@/lib/auth/roles";

export const metadata = {
  title: "Tourism & Events — Admin",
  description: "Manage events and tourism content — approve, flag, or remove.",
};

export default async function AdminPromotionsEventsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isStaff(user)) {
    redirect("/dashboard");
  }

  const [pendingVerifications, pendingContent, reports, activity, actionsToday] = await Promise.all(
    [
      getPendingVerificationGroups(),
      getPendingContent("PROMOTIONS_EVENTS"),
      getAreaReports("PROMOTIONS_EVENTS"),
      getRecentActivity(20, "PROMOTIONS_EVENTS"),
      getActionsToday("PROMOTIONS_EVENTS"),
    ]
  );
  const pendingVerificationCount = pendingVerifications.reduce(
    (count, group) => count + group.steps.length,
    0
  );

  const highSeverityOverdue = reports.filter((r: DashboardReport) => {
    if (r.severity !== "high") return false;
    const sla = calculateSlaState(r.created_at, "high");
    return sla.state === "breached";
  }).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tourism & Events"
        description="Moderation and reports for Tourism & Events."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Tourism & Events" }]}
      >
        <Badge variant="outline">PROMOTIONS_EVENTS</Badge>
      </PageHeader>

      <AreaAdminTabs
        area="PROMOTIONS_EVENTS"
        areaLabel="Tourism & Events"
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
