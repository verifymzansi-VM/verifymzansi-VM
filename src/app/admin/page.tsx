import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getRoleFromUser, isStaff } from "@/lib/auth/roles";
import {
  getAdminDashboardStats,
  getDashboardReports,
  getExtendedPlatformStats,
  getDashboardAreaSummary,
  getAreaCardCounts,
  getVerificationStepCounts,
  type AdminDashboardStats,
  type VerificationStepCounts,
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

const ROLE_LABELS: Record<string, string> = {
  moderator: "Moderator",
  governance_controller: "Governance",
  admin: "Admin",
};

const ROLE_VARIANTS: Record<string, "secondary" | "destructive" | "outline"> = {
  moderator: "secondary",
  governance_controller: "outline",
  admin: "destructive",
};

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = getRoleFromUser(user);
  if (!isStaff(user) || !role) redirect("/dashboard");

  const isAdminRole = role === "admin";
  const isGovernance = role === "governance_controller";
  const roleLabel = ROLE_LABELS[role] ?? role;
  const roleBadgeVariant = ROLE_VARIANTS[role] ?? "secondary";

  const EMPTY_STATS: AdminDashboardStats = {
    totalAccounts: 0,
    totalMembers: 0,
    totalListings: 0,
    openReports: 0,
    pendingVerifications: 0,
    activeSuspensions: 0,
    pendingModeration: 0,
  };
  const EMPTY_STEP_COUNTS: VerificationStepCounts = {
    phone: 0,
    id_doc: 0,
    selfie: 0,
    location: 0,
    total: 0,
  };
  const EMPTY_AREA = {
    totalPosted: 0,
    pendingReview: 0,
    liveCount: 0,
    rejectedCount: 0,
    topCategory: null,
    categoryBreakdown: [],
  };
  const EMPTY_AREA_COUNTS = { pendingFlags: 0, pendingContent: 0 };

  const settled = await Promise.allSettled([
    getAdminDashboardStats(),
    getDashboardReports(10),
    isAdminRole || isGovernance ? getExtendedPlatformStats() : Promise.resolve(null),
    getDashboardAreaSummary(),
    getAreaCardCounts(),
    getVerificationStepCounts(),
  ]);

  const stats = settled[0].status === "fulfilled" ? settled[0].value : EMPTY_STATS;
  const reports = settled[1].status === "fulfilled" ? settled[1].value : [];
  const extended = settled[2].status === "fulfilled" ? settled[2].value : null;
  const areaSummary =
    settled[3].status === "fulfilled"
      ? settled[3].value
      : { MZANSI_MARKET: EMPTY_AREA, MZANSI_BUSINESS: EMPTY_AREA, PROMOTIONS_EVENTS: EMPTY_AREA };
  const areaCounts =
    settled[4].status === "fulfilled"
      ? settled[4].value
      : {
          MZANSI_MARKET: EMPTY_AREA_COUNTS,
          MZANSI_BUSINESS: EMPTY_AREA_COUNTS,
          PROMOTIONS_EVENTS: EMPTY_AREA_COUNTS,
        };
  const stepCounts = settled[5].status === "fulfilled" ? settled[5].value : EMPTY_STEP_COUNTS;

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
  const totalAccounts = stats.totalAccounts;
  const verifiedAccounts = extended?.verifiedAccounts ?? 0;
  const bannedAccounts = extended?.bannedAccounts ?? 0;
  const verifiedPct =
    isAdminRole && extended && totalAccounts > 0
      ? Math.round((verifiedAccounts / totalAccounts) * 100)
      : null;

  const overviewMetrics = [
    { label: "Accounts", value: totalAccounts },
    ...(verifiedPct !== null ? [{ label: "Verified", value: `${verifiedPct}%` }] : []),
    ...((isAdminRole || isGovernance) && extended
      ? [{ label: "Live Content", value: extended.liveListings }]
      : []),
    { label: "KYC queue", value: stats.pendingVerifications },
    { label: "Reports", value: stats.openReports },
    { label: "Moderation", value: stats.pendingModeration },
  ];

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────── */}
      <PageHeader title="Admin" breadcrumbs={[{ label: "Admin" }]}>
        <Badge variant={roleBadgeVariant}>{roleLabel}</Badge>
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

      {/* ── 4. Admin/Governance Controls ───────────────────── */}
      {(isAdminRole || isGovernance) && extended && (
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
