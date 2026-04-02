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
  title: "Mzansi Business — Admin",
  description: "Manage registered businesses — review, approve, or flag business listings.",
};

export default async function AdminBusinessesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isStaff(user)) {
    redirect("/dashboard");
  }

  const settled = await Promise.allSettled([
    getPendingVerificationGroups(),
    getPendingContent("MZANSI_BUSINESS"),
    getAreaReports("MZANSI_BUSINESS"),
    getRecentActivity(20, "MZANSI_BUSINESS"),
    getActionsToday("MZANSI_BUSINESS"),
  ]);

  const pendingVerifications = settled[0].status === "fulfilled" ? settled[0].value : [];
  const pendingContent = settled[1].status === "fulfilled" ? settled[1].value : [];
  const reports = settled[2].status === "fulfilled" ? settled[2].value : [];
  const activity = settled[3].status === "fulfilled" ? settled[3].value : [];
  const actionsToday = settled[4].status === "fulfilled" ? settled[4].value : {};
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
        title="Mzansi Business"
        description="Moderation and reports for Mzansi Business."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Mzansi Business" }]}
      >
        <Badge variant="outline">MZANSI_BUSINESS</Badge>
      </PageHeader>

      <AreaAdminTabs
        area="MZANSI_BUSINESS"
        areaLabel="Mzansi Business"
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
