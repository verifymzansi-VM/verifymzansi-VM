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
  title: "Business Ads | Admin | VerifyMzansi",
};

export default async function AdminBusinessAdsPage() {
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
      getPendingContent("BUSINESS_ADS"),
      getAreaReports("BUSINESS_ADS"),
      getRecentActivity(20, "BUSINESS_ADS"),
      getActionsToday("BUSINESS_ADS"),
    ]
  );

  // Calculate high severity overdue count

  const highSeverityOverdue = reports.filter((r: DashboardReport) => {
    if (r.severity !== "high") return false;
    const sla = calculateSlaState(r.created_at, "high");
    return sla.state === "breached";
  }).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Ads"
        description="Manage verification, content moderation, and flagged reports for Business Ads."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Business Ads" }]}
      >
        <Badge variant="outline">BUSINESS_ADS</Badge>
      </PageHeader>

      <AreaAdminTabs
        area="BUSINESS_ADS"
        areaLabel="Business Ads"
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
