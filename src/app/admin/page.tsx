import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getRoleFromUser, isModeratorOrAdmin } from "@/lib/auth/roles";
import {
  getAdminDashboardStats,
  getDashboardReports,
  getMyActionsToday,
  getExtendedPlatformStats,
  getAreaCardCounts,
} from "@/lib/utils/admin-queries";
import { calculateSlaState } from "@/lib/utils/sla";
import type { ReportSeverity } from "@/types/enums";
import {
  OverviewStrip,
  QueueMiniCard,
  AreaStrip,
  YourSpace,
  AdminControls,
} from "@/components/admin/dashboard-cards";

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

  const [stats, reports, myActions, extended, areaCounts] = await Promise.all([
    getAdminDashboardStats(),
    getDashboardReports(10),
    getMyActionsToday(user.id),
    isAdminRole ? getExtendedPlatformStats() : Promise.resolve(null),
    getAreaCardCounts(),
  ]);

  // ── Compute health status ──────────────────────────────────
  const breachedReports = reports.filter((r) => {
    const sla = calculateSlaState(r.created_at, r.severity as ReportSeverity);
    return sla.state === "breached";
  });
  const atRiskReports = reports.filter((r) => {
    const sla = calculateSlaState(r.created_at, r.severity as ReportSeverity);
    return sla.state === "at-risk";
  });
  const onTrackReports = reports.filter((r) => {
    const sla = calculateSlaState(r.created_at, r.severity as ReportSeverity);
    return sla.state === "on-track";
  });

  const healthStatus =
    breachedReports.length > 0
      ? "critical"
      : stats.pendingVerifications >= 30 || stats.openReports > 0 || stats.pendingModeration >= 20
        ? "warning"
        : "healthy";

  // ── Overview metrics ───────────────────────────────────────
  const verifiedPct =
    isAdminRole && extended && stats.totalSellers > 0
      ? Math.round((extended.verifiedSellers / stats.totalSellers) * 100)
      : null;

  const overviewMetrics = [
    { label: "Sellers", value: stats.totalSellers },
    ...(verifiedPct !== null ? [{ label: "Verified", value: `${verifiedPct}%` }] : []),
    ...(isAdminRole && extended ? [{ label: "Live", value: extended.liveListings }] : []),
    { label: "KYC queue", value: stats.pendingVerifications },
    { label: "Reports", value: stats.openReports },
    { label: "Moderation", value: stats.pendingModeration },
  ];

  // ── Areas data ─────────────────────────────────────────────
  const areas = [
    {
      label: "Mzansi Market",
      href: "/admin/mzansi-market",
      flags: areaCounts.MZANSI_MARKET.pendingFlags,
      pending: areaCounts.MZANSI_MARKET.pendingContent,
    },
    {
      label: "Mzansi Business",
      href: "/admin/businesses",
      flags: areaCounts.MZANSI_BUSINESS.pendingFlags,
      pending: areaCounts.MZANSI_BUSINESS.pendingContent,
    },
    {
      label: "Promotions & Events",
      href: "/admin/businesses",
      flags: areaCounts.PROMOTIONS_EVENTS.pendingFlags,
      pending: areaCounts.PROMOTIONS_EVENTS.pendingContent,
    },
  ];

  return (
    <div className="space-y-3">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold tracking-tight">Admin</h1>
        <Badge variant={isAdminRole ? "destructive" : "secondary"}>
          {isAdminRole ? "Admin" : "Moderator"}
        </Badge>
      </div>

      {/* ── 1. Overview Strip ───────────────────────────────── */}
      <OverviewStrip status={healthStatus} metrics={overviewMetrics} />

      {/* ── 2. Work Queues ──────────────────────────────────── */}
      <section>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Queues
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <QueueMiniCard
            label="KYC"
            count={stats.pendingVerifications}
            href="/admin/verification"
            capacity={50}
          />
          <QueueMiniCard
            label="Reports"
            count={stats.openReports}
            href="/admin/reports"
            severityDots={{
              breached: breachedReports.length,
              atRisk: atRiskReports.length,
              onTrack: onTrackReports.length,
            }}
          />
          <QueueMiniCard
            label="Moderation"
            count={stats.pendingModeration}
            href="/admin/moderation"
            capacity={30}
          />
        </div>
      </section>

      {/* ── 3. Marketplace Areas ────────────────────────────── */}
      <AreaStrip areas={areas} />

      {/* ── 4. Your Space (moderator zone) ──────────────────── */}
      <YourSpace
        myActions={myActions}
        queueCounts={{
          kyc: stats.pendingVerifications,
          reports: stats.openReports,
          moderation: stats.pendingModeration,
        }}
      />

      {/* ── 5. Admin Controls (admin only) ──────────────────── */}
      {isAdminRole && extended && (
        <AdminControls
          enforcementStats={{
            hidden: extended.hiddenListings,
            suspended: stats.activeSuspensions,
            banned: extended.bannedSellers,
          }}
        />
      )}
    </div>
  );
}
