import { requireStaff } from "@/lib/auth/require-staff";
import { getClaimsForItems, type ClaimItemType } from "@/lib/services/queue-claims";
import { QueueClaimsProvider } from "@/components/admin/queue-claims";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { AreaAdminTabs } from "@/components/admin/area-admin-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
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
  const { user, role } = await requireStaff("queue:view");

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

  const claimItems: Array<{ type: ClaimItemType; id: string }> = [
    ...pendingVerifications.flatMap((group) =>
      group.steps.map((step) => ({ type: "verification_step" as const, id: step.id }))
    ),
    ...pendingContent.map((item) => ({
      type: (item.isEditRequest
        ? "content_edit"
        : (item.contentType ?? "listing")) as ClaimItemType,
      id: item.id,
    })),
    ...reports.map((report: DashboardReport) => ({ type: "report" as const, id: report.id })),
  ];
  const claims = await getClaimsForItems(user.id, claimItems);

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

      {settled[1].status === "rejected" && (
        <p role="alert" className="text-sm text-destructive">
          The content review queue could not be loaded. Refresh to try again.
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        Claim items from the Verification, Moderation and Reports queues to work on them here.
      </p>

      <QueueClaimsProvider
        claims={claims}
        mustClaim={role === "moderator"}
        canFree={roleHasCapability(role, "decision:approve")}
      >
        <AreaAdminTabs
          canEnforceDirectly={roleHasCapability(role, "enforcement:execute")}
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
      </QueueClaimsProvider>
    </div>
  );
}
