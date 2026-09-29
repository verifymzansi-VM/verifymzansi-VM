import { Suspense } from "react";
import { requireStaff } from "@/lib/auth/require-staff";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { HOME_TITLES } from "@/lib/admin/nav";
import { getStaffDashboard } from "@/lib/services/staff-dashboard";
import { PageHeader } from "@/components/layout/page-header";
import {
  DashboardUnavailable,
  formatCount,
  QueueOverview,
  SectionHeading,
  StatCard,
} from "@/components/admin/home/home-cards";
import { MyShiftPanel } from "@/components/admin/home/my-shift-panel";
import {
  DecisionsPanel,
  OversightPanel,
  PlatformPanel,
  TeamPanel,
} from "@/components/admin/home/decision-panels";
import { TrafficPanel, TrafficPanelSkeleton } from "@/components/admin/home/traffic-panel";

export const metadata = {
  title: "Admin",
  description: "Your VerifyMzansi staff home: the work waiting for you.",
};

const DESCRIPTIONS = {
  moderator: "Claim work, keep it moving, and hand anything serious up for a decision.",
  governance_controller:
    "Escalations, appeals, restrictions and data requests that need your decision.",
  admin: "Platform health, the team, and everything waiting for a decision.",
} as const;

export default async function AdminHomePage() {
  const { user, role } = await requireStaff();
  const dashboard = await getStaffDashboard(user.id);

  return (
    <div className="space-y-8">
      <PageHeader
        title={HOME_TITLES[role]}
        description={DESCRIPTIONS[role]}
        breadcrumbs={[{ label: "Admin" }]}
      />

      {!dashboard ? (
        <DashboardUnavailable />
      ) : (
        <>
          {"shift" in dashboard && (
            <section className="space-y-3" aria-labelledby="home-shift">
              <div id="home-shift" className="flex flex-wrap items-end justify-between gap-2">
                <SectionHeading
                  title="Your items"
                  description="Only you can decide items you hold. Release what you cannot finish."
                />
                {dashboard.shift && (
                  <p className="text-sm text-muted-foreground">
                    {formatCount(dashboard.shift.actions_today)} actions today
                    {dashboard.shift.escalations_open > 0 &&
                      ` · ${formatCount(dashboard.shift.escalations_open)} of your escalations waiting`}
                  </p>
                )}
              </div>
              {dashboard.shift ? (
                <MyShiftPanel
                  claims={dashboard.shift.claims}
                  canClaim={roleHasCapability(role, "queue:claim")}
                />
              ) : (
                <StatCard label="Your items" value={null} />
              )}
            </section>
          )}

          {role === "admin" && (
            <PlatformPanel
              platform={dashboard.platform}
              retention={dashboard.retention}
              breachedReports={dashboard.queues.reports?.breached}
            />
          )}

          {"decisions" in dashboard && (
            <DecisionsPanel
              decisions={dashboard.decisions}
              restrictions={dashboard.restrictions}
              dsar={dashboard.dsar}
            />
          )}

          <section className="space-y-3" aria-labelledby="home-queues">
            <div id="home-queues">
              <SectionHeading
                title="Queues"
                description={
                  role === "moderator"
                    ? "Most urgent first when you claim."
                    : "What moderators are working through."
                }
              />
            </div>
            <QueueOverview queues={dashboard.queues} />
          </section>

          {"oversight" in dashboard && <OversightPanel oversight={dashboard.oversight} />}

          {role === "admin" && (
            <>
              <TeamPanel
                platform={dashboard.platform}
                roleChanges={dashboard.decisions?.role_changes_pending}
              />
              <Suspense fallback={<TrafficPanelSkeleton />}>
                <TrafficPanel />
              </Suspense>
            </>
          )}
        </>
      )}
    </div>
  );
}
