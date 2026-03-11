import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getRoleFromUser, isModeratorOrAdmin } from "@/lib/auth/roles";
import {
  getAdminDashboardStats,
  getDashboardReports,
  getExtendedPlatformStats,
  getDashboardAreaSummary,
  getAreaCardCounts,
  getVerificationStepCounts,
} from "@/lib/utils/admin-queries";
import { calculateSlaState } from "@/lib/utils/sla";
import type { ReportSeverity } from "@/types/enums";
import {
  OverviewStrip,
  VerificationCard,
  AreaDashboardCard,
  AdminControls,
} from "@/components/admin/dashboard-cards";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = {
  title: "Admin Dashboard",
  description: "VerifyMzansi admin overview — pending verifications, reports, and platform stats.",
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

  const [stats, reports, extended, areaSummary, areaCounts, stepCounts] = await Promise.all([
    getAdminDashboardStats(),
    getDashboardReports(10),
    isAdminRole ? getExtendedPlatformStats() : Promise.resolve(null),
    getDashboardAreaSummary(),
    getAreaCardCounts(),
    getVerificationStepCounts(),
  ]);

  // ── Compute health status ──────────────────────────────────
  const breachedReports = reports.filter((r) => {
    const sla = calculateSlaState(r.created_at, r.severity as ReportSeverity);
    return sla.state === "breached";
  });

  const healthStatus =
    breachedReports.length > 0
      ? "critical"
      : stats.pendingVerifications >= 30 || stats.openReports > 0 || stats.pendingModeration >= 20
        ? "warning"
        : "healthy";

  // ── Overview metrics ───────────────────────────────────────
  const totalAccounts = stats.totalAccounts ?? stats.totalSellers;
  const verifiedAccounts = extended?.verifiedAccounts ?? extended?.verifiedSellers ?? 0;
  const bannedAccounts = extended?.bannedAccounts ?? extended?.bannedSellers ?? 0;
  const verifiedPct =
    isAdminRole && extended && totalAccounts > 0
      ? Math.round((verifiedAccounts / totalAccounts) * 100)
      : null;

  const overviewMetrics = [
    { label: "Accounts", value: totalAccounts },
    ...(verifiedPct !== null ? [{ label: "Verified", value: `${verifiedPct}%` }] : []),
    ...(isAdminRole && extended ? [{ label: "Live", value: extended.liveListings }] : []),
    { label: "KYC queue", value: stats.pendingVerifications },
    { label: "Reports", value: stats.openReports },
    { label: "Moderation", value: stats.pendingModeration },
  ];

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────── */}
      <PageHeader title="Admin" breadcrumbs={[{ label: "Admin" }]}>
        <Badge variant={isAdminRole ? "destructive" : "secondary"}>
          {isAdminRole ? "Admin" : "Moderator"}
        </Badge>
      </PageHeader>

      {/* ── 1. Overview Strip ───────────────────────────────── */}
      <OverviewStrip status={healthStatus} metrics={overviewMetrics} />

      {/* ── 2. Verification ─────────────────────────────────── */}
      <VerificationCard pendingVerifications={stats.pendingVerifications} stepCounts={stepCounts} />

      {/* ── 3. Marketplace Areas ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <AreaDashboardCard
          area="MZANSI_MARKET"
          stats={areaSummary.MZANSI_MARKET}
          flagCount={areaCounts.MZANSI_MARKET.pendingFlags}
        />
        <AreaDashboardCard
          area="MZANSI_BUSINESS"
          stats={areaSummary.MZANSI_BUSINESS}
          flagCount={areaCounts.MZANSI_BUSINESS.pendingFlags}
        />
        <AreaDashboardCard
          area="PROMOTIONS_EVENTS"
          stats={areaSummary.PROMOTIONS_EVENTS}
          flagCount={areaCounts.PROMOTIONS_EVENTS.pendingFlags}
        />
      </div>

      {/* ── 4. Admin Controls (admin only) ──────────────────── */}
      {isAdminRole && extended && (
        <AdminControls
          enforcementStats={{
            hidden: extended.hiddenListings,
            suspended: stats.activeSuspensions,
            banned: bannedAccounts,
          }}
        />
      )}
    </div>
  );
}
