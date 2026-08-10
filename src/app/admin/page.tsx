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
import { RoleCommandCenter, AreaDashboardCard } from "@/components/admin/dashboard-cards";
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
  const dashboardRole =
    role === "admin" || role === "governance_controller" || role === "moderator"
      ? role
      : "moderator";
  const roleLabel = ROLE_LABELS[role] ?? role;
  const roleBadgeVariant = ROLE_VARIANTS[role] ?? "secondary";

  const EMPTY_STATS: AdminDashboardStats = {
    totalAccounts: 0,
    totalMembers: 0,
    totalListings: 0,
    openReports: 0,
    supportRequests: 0,
    pendingVerifications: 0,
    activeSuspensions: 0,
    pendingModeration: 0,
  };
  const EMPTY_STEP_COUNTS: VerificationStepCounts = {
    phone: 0,
    id_doc: 0,
    selfie: 0,
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
      : stats.pendingVerifications >= 30 ||
          stats.openReports > 0 ||
          stats.supportRequests > 0 ||
          stats.pendingModeration >= 20
        ? "warning"
        : "healthy";

  const totalAccounts = stats.totalAccounts;
  const verifiedAccounts = extended?.verifiedAccounts ?? 0;
  const verifiedPct =
    isAdminRole && extended && totalAccounts > 0
      ? Math.round((verifiedAccounts / totalAccounts) * 100)
      : null;

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────── */}
      <PageHeader title={`${roleLabel} Command Center`} breadcrumbs={[{ label: "Admin" }]}>
        <Badge variant={roleBadgeVariant}>{roleLabel}</Badge>
      </PageHeader>

      <RoleCommandCenter
        role={dashboardRole}
        healthStatus={healthStatus}
        stats={stats}
        verifiedPct={verifiedPct}
        reports={reports}
        breachedReportCount={breachedReports.length}
        areaSummary={areaSummary}
        areaCounts={areaCounts}
        stepCounts={stepCounts}
        extended={extended}
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Area workload</h2>
          <p className="text-xs text-muted-foreground">
            Marketplace, business, and tourism queues show content state and flag pressure together.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
      </section>
    </div>
  );
}
