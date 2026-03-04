import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { FileCheck, Flag, Clock, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/layout/page-header";
import { ActivityFeedCard } from "@/components/admin/activity-feed";
import { DashboardAlerts, QueueCard, StatLine } from "@/components/admin/dashboard-cards";
import { getRoleFromUser, isModeratorOrAdmin } from "@/lib/auth/roles";
import {
  getAdminDashboardStats,
  getDashboardReports,
  getRecentActivity,
  getActionsToday,
  getExtendedPlatformStats,
} from "@/lib/utils/admin-queries";
import { calculateSlaState } from "@/lib/utils/sla";
import type { ReportSeverity } from "@/types/enums";

export const metadata = {
  title: "Admin Dashboard | VerifyMzansi",
};

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = getRoleFromUser(user);
  if (!isModeratorOrAdmin(user) || !role) redirect("/dashboard");

  const isAdminRole = role === "admin";

  // 4-5 lightweight queries (down from 9 heavy ones)
  const [stats, reports, activity, actionsToday, extended] = await Promise.all([
    getAdminDashboardStats(),
    getDashboardReports(10),
    getRecentActivity(5),
    getActionsToday(),
    isAdminRole ? getExtendedPlatformStats() : Promise.resolve(null),
  ]);

  // ── Compute alerts ────────────────────────────────────────
  const highReports = reports.filter((r) => r.severity === "high");
  const breachedReports = reports.filter((r) => {
    const sla = calculateSlaState(r.created_at, r.severity as ReportSeverity);
    return sla.state === "breached";
  });

  const alerts: { message: string; href: string; severity: "critical" | "warning" }[] = [];

  if (breachedReports.length > 0) {
    alerts.push({
      message: `${breachedReports.length} report${breachedReports.length > 1 ? "s" : ""} breached SLA — review immediately`,
      href: "/admin/reports",
      severity: "critical",
    });
  } else if (highReports.length > 0) {
    alerts.push({
      message: `${highReports.length} high-severity report${highReports.length > 1 ? "s" : ""} need urgent review`,
      href: "/admin/reports",
      severity: "warning",
    });
  }

  if (stats.pendingVerifications >= 30) {
    alerts.push({
      message: `${stats.pendingVerifications} KYC submissions queued — consider prioritising`,
      href: "/admin/verification",
      severity: "warning",
    });
  }

  if (stats.pendingModeration >= 20) {
    alerts.push({
      message: `${stats.pendingModeration} items awaiting first-time approval`,
      href: "/admin/moderation",
      severity: "warning",
    });
  }

  // ── Actions today summary ─────────────────────────────────
  const totalActions = Object.values(actionsToday).reduce((a, b) => a + b, 0);
  const actionEntries = Object.entries(actionsToday).filter(([, v]) => v > 0);

  // ── Platform health (admin only) ─────────────────────────
  const verifiedPct =
    isAdminRole && extended && stats.totalSellers > 0
      ? Math.round((extended.verifiedSellers / stats.totalSellers) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* ── Alerts ──────────────────────────────────────────── */}
      <DashboardAlerts alerts={alerts} />

      <PageHeader title="Dashboard">
        <Badge variant={isAdminRole ? "destructive" : "default"}>
          {isAdminRole ? "Admin" : "Moderator"}
        </Badge>
      </PageHeader>

      {/* ── Work Queues ─────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Work Queues
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <QueueCard
            icon={FileCheck}
            label="Pending KYC"
            count={stats.pendingVerifications}
            href="/admin/verification"
            subtitle="Identity submissions"
          />
          <QueueCard
            icon={Flag}
            label="Open Reports"
            count={stats.openReports}
            href="/admin/reports"
            subtitle={
              highReports.length > 0 ? `${highReports.length} high-severity` : "No high-severity"
            }
            urgent={highReports.length > 0}
          />
          <QueueCard
            icon={Clock}
            label="Awaiting Approval"
            count={stats.pendingModeration}
            href="/admin/moderation"
            subtitle="New content pending review"
          />
        </div>
      </section>

      {/* ── Platform Health (admin only) ────────────────────── */}
      {isAdminRole && extended && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Platform Health
          </h2>
          <Card>
            <CardContent className="pt-5 pb-4">
              <StatLine
                items={[
                  {
                    label: "Sellers",
                    value: `${stats.totalSellers} (${verifiedPct}% verified)`,
                  },
                  { label: "Live listings", value: extended.liveListings },
                  {
                    label: "Hidden",
                    value: extended.hiddenListings,
                    warn: extended.hiddenListings > 0,
                  },
                  {
                    label: "Suspended",
                    value: stats.activeSuspensions,
                    warn: stats.activeSuspensions > 0,
                  },
                  {
                    label: "Banned",
                    value: extended.bannedSellers,
                    warn: extended.bannedSellers > 0,
                  },
                ]}
              />
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Actions Today + Recent Activity ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <ShieldAlert className="h-4 w-4" />
              Actions Today
            </h3>
            {totalActions === 0 ? (
              <p className="text-sm text-muted-foreground">No actions yet today.</p>
            ) : (
              <div className="space-y-1.5">
                {actionEntries.map(([action, count]) => (
                  <div key={action} className="flex justify-between text-sm">
                    <span className="text-muted-foreground capitalize">
                      {action.replace(/_/g, " ")}
                    </span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between text-sm font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{totalActions}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <ActivityFeedCard entries={activity} title="Recent Activity" />
        </div>
      </div>
    </div>
  );
}
