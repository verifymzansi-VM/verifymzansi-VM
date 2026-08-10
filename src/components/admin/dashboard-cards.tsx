import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight,
  ShoppingBag,
  Building2,
  TreePalm,
  TrendingUp,
  TrendingDown,
  Eye,
  FileCheck,
  XCircle,
  Zap,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Gavel,
  LockKeyhole,
  RadioTower,
  ScrollText,
  Settings2,
  Users,
} from "lucide-react";
import type {
  AreaSummaryStats,
  AdminDashboardStats,
  DashboardReport,
  ExtendedPlatformStats,
  VerificationStepCounts,
} from "@/lib/utils/admin-queries";

type HealthStatus = "healthy" | "warning" | "critical";

const STATUS_CONFIG: Record<HealthStatus, { stripe: string; dot: string; label: string }> = {
  healthy: {
    stripe: "border-l-brand-green-500",
    dot: "bg-brand-green-500",
    label: "Healthy",
  },
  warning: {
    stripe: "border-l-brand-gold-500",
    dot: "bg-brand-gold-500",
    label: "Needs attention",
  },
  critical: {
    stripe: "border-l-brand-red-500",
    dot: "bg-brand-red-500 animate-pulse-soft",
    label: "Urgent",
  },
};

// ── Role Command Center ──────────────────────────────────────

type StaffDashboardRole = "moderator" | "governance_controller" | "admin";

interface RoleCommandCenterProps {
  role: StaffDashboardRole;
  healthStatus: HealthStatus;
  stats: AdminDashboardStats;
  verifiedPct: number | null;
  reports: DashboardReport[];
  breachedReportCount: number;
  areaSummary: Record<"MZANSI_MARKET" | "MZANSI_BUSINESS" | "PROMOTIONS_EVENTS", AreaSummaryStats>;
  areaCounts: Record<
    "MZANSI_MARKET" | "MZANSI_BUSINESS" | "PROMOTIONS_EVENTS",
    { pendingFlags: number; pendingContent: number }
  >;
  stepCounts: VerificationStepCounts;
  extended: ExtendedPlatformStats | null;
}

const ROLE_COPY: Record<
  StaffDashboardRole,
  {
    eyebrow: string;
    title: string;
    description: string;
    primaryHref: string;
    primaryLabel: string;
  }
> = {
  moderator: {
    eyebrow: "Operations workspace",
    title: "Clear today's queues without guessing what comes next.",
    description:
      "Verification, moderation, and reports are grouped by urgency so operators can act, escalate, or move to the right area queue.",
    primaryHref: "/admin/verification",
    primaryLabel: "Open verification queue",
  },
  governance_controller: {
    eyebrow: "Governance workspace",
    title: "Decide the cases that need policy judgment.",
    description:
      "Escalations, appeals, enforcement, and audit context are separated from routine moderation so decisions have a clear record.",
    primaryHref: "/admin/governance/escalations",
    primaryLabel: "Review escalations",
  },
  admin: {
    eyebrow: "Admin workspace",
    title: "See the platform signal, then drill into operations or governance.",
    description:
      "Admin gets the whole system view: growth, trust health, backlog pressure, governance risk, and configuration tools.",
    primaryHref: "/admin/intelligence/users",
    primaryLabel: "Open intelligence",
  },
};

function formatAreaLabel(area: keyof typeof AREA_CONFIG) {
  return AREA_CONFIG[area].title;
}

function getHealthLabel(status: HealthStatus) {
  return STATUS_CONFIG[status].label;
}

/** A dashboard metric row. `href: null` renders a static card (no dead-end link). */
interface MetricItem {
  label: string;
  value: string | number;
  detail: string;
  href: string | null;
}

export function RoleCommandCenter({
  role,
  healthStatus,
  stats,
  verifiedPct,
  reports,
  breachedReportCount,
  areaSummary,
  areaCounts,
  stepCounts,
  extended,
}: RoleCommandCenterProps) {
  const copy = ROLE_COPY[role];
  const totalPendingContent =
    areaCounts.MZANSI_MARKET.pendingContent +
    areaCounts.MZANSI_BUSINESS.pendingContent +
    areaCounts.PROMOTIONS_EVENTS.pendingContent;
  const totalFlags =
    areaCounts.MZANSI_MARKET.pendingFlags +
    areaCounts.MZANSI_BUSINESS.pendingFlags +
    areaCounts.PROMOTIONS_EVENTS.pendingFlags;
  const busiestArea = (
    Object.entries(areaSummary) as Array<[keyof typeof AREA_CONFIG, AreaSummaryStats]>
  )
    .filter(([, areaStats]) => areaStats.pendingReview > 0)
    .sort(([, a], [, b]) => b.pendingReview - a.pendingReview)[0];
  const latestReport = reports[0];

  const operationsItems: MetricItem[] = [
    {
      label: "KYC waiting",
      value: stats.pendingVerifications,
      detail: `${stepCounts.id_doc} ID docs, ${stepCounts.selfie} selfies, ${stepCounts.phone} phone checks`,
      href: "/admin/verification",
    },
    {
      label: "Content review",
      value: totalPendingContent,
      detail: busiestArea
        ? `${formatAreaLabel(busiestArea[0])} has ${busiestArea[1].pendingReview} pending`
        : "No area backlog",
      href: "/admin/moderation",
    },
    {
      label: "Open reports",
      value: stats.openReports,
      detail: breachedReportCount > 0 ? `${breachedReportCount} breached SLA` : "No breached SLA",
      href: "/admin/reports",
    },
    {
      label: "Support requests",
      value: stats.supportRequests,
      detail:
        stats.supportRequests > 0
          ? `${stats.supportRequests} new contact ${stats.supportRequests === 1 ? "request" : "requests"}`
          : "No new support requests",
      href: "/admin/support",
    },
  ];

  const governanceItems: MetricItem[] = [
    {
      label: "Escalations",
      value: breachedReportCount,
      detail: breachedReportCount > 0 ? "SLA-breached or high-risk cases" : "No breached cases",
      href: "/admin/governance/escalations",
    },
    {
      label: "Enforcement",
      value: stats.activeSuspensions,
      detail: `${extended?.bannedAccounts ?? 0} banned accounts on record`,
      href: "/admin/governance/enforcement",
    },
    {
      label: "Appeals & DSAR",
      value: totalFlags,
      detail: latestReport
        ? `Latest ${latestReport.severity} report: ${latestReport.category}`
        : "No active report signal",
      href: "/admin/governance/appeals",
    },
  ];

  const adminItems: MetricItem[] = [
    {
      label: "Accounts",
      value: stats.totalAccounts,
      detail:
        verifiedPct === null
          ? "Verification rate hidden for this role"
          : `${verifiedPct}% verified`,
      href: "/admin/intelligence/users",
    },
    {
      label: "Live content",
      value: extended?.liveListings ?? areaSummary.MZANSI_MARKET.liveCount,
      detail: `${extended?.hiddenListings ?? 0} hidden content records`,
      href: "/admin/intelligence/marketplace",
    },
    {
      label: "Controls",
      value: role === "admin" ? "Full" : "Limited",
      detail: role === "admin" ? "Roles, feature flags, audit log" : "Restricted by role",
      href: role === "admin" ? "/admin/feature-flags" : "/admin/audit-log",
    },
  ];

  const focusItems =
    role === "governance_controller"
      ? governanceItems
      : role === "admin"
        ? adminItems
        : operationsItems;

  const roleOrder =
    role === "admin"
      ? ["admin", "operations", "governance"]
      : role === "governance_controller"
        ? ["governance", "operations", "admin"]
        : ["operations", "governance", "admin"];

  const workstreams = {
    operations: {
      title: "Operations",
      description: "Daily queues for verification, content, and reports.",
      icon: ClipboardList,
      href: "/admin/verification",
      items: operationsItems,
      locked: false,
    },
    governance: {
      title: "Governance",
      description: "Policy decisions, appeals, enforcement, and audit context.",
      icon: Gavel,
      href: "/admin/governance/escalations",
      items: governanceItems,
      locked: role === "moderator",
    },
    admin: {
      title: "Admin",
      description: "Platform intelligence, roles, feature flags, and configuration.",
      icon: Settings2,
      href: "/admin/intelligence/users",
      items: adminItems,
      locked: role !== "admin",
    },
  } as const;

  return (
    <section className="rounded-2xl border bg-background shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-5 border-b p-4 sm:p-5 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {copy.eyebrow}
              </p>
              <h2 className="mt-2 max-w-4xl text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {copy.title}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{copy.description}</p>
            </div>
            <Link
              href={copy.primaryHref}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-foreground/85"
            >
              {copy.primaryLabel}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {focusItems.map((item) => {
              const cardBody = (
                <>
                  <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p>
                  <p className="mt-1 min-h-8 text-xs text-muted-foreground">{item.detail}</p>
                </>
              );
              const cardClass =
                "rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/60";
              return item.href ? (
                <Link key={item.label} href={item.href} className={cardClass}>
                  {cardBody}
                </Link>
              ) : (
                <div
                  key={item.label}
                  className={cardClass}
                  title="No dedicated page yet — shown for visibility"
                >
                  {cardBody}
                </div>
              );
            })}
          </div>
        </div>

        <SignalBoard
          healthStatus={healthStatus}
          reports={reports}
          stats={stats}
          totalPendingContent={totalPendingContent}
        />
      </div>

      <div className="grid border-t md:grid-cols-3">
        {roleOrder.map((key, index) => {
          const stream = workstreams[key as keyof typeof workstreams];
          return (
            <WorkstreamPanel
              key={stream.title}
              {...stream}
              isPrimary={index === 0}
              className={index > 0 ? "border-t md:border-l md:border-t-0" : ""}
            />
          );
        })}
      </div>
    </section>
  );
}

function SignalBoard({
  healthStatus,
  reports,
  stats,
  totalPendingContent,
}: {
  healthStatus: HealthStatus;
  reports: DashboardReport[];
  stats: AdminDashboardStats;
  totalPendingContent: number;
}) {
  const topSignals = [
    {
      label: "Platform status",
      value: getHealthLabel(healthStatus),
      icon: healthStatus === "healthy" ? CheckCircle2 : BellRing,
    },
    {
      label: "Notification priority",
      value:
        stats.openReports > 0
          ? `${stats.openReports} reports`
          : stats.supportRequests > 0
            ? `${stats.supportRequests} support`
            : stats.pendingVerifications > 0
              ? `${stats.pendingVerifications} KYC`
              : "Clear",
      icon: RadioTower,
    },
    {
      label: "Backlog pressure",
      value: `${
        stats.pendingVerifications +
        totalPendingContent +
        stats.pendingModeration +
        stats.supportRequests
      } tasks`,
      icon: Users,
    },
  ];

  return (
    <aside className="space-y-4 bg-muted/20 p-4 sm:p-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Notification focus
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Staff should see the next decision, not only raw totals.
        </p>
      </div>

      <div className="space-y-2">
        {topSignals.map((signal) => {
          const Icon = signal.icon;
          return (
            <div
              key={signal.label}
              className="flex items-center gap-3 rounded-lg bg-background p-3"
            >
              <Icon className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{signal.label}</p>
                <p className="truncate text-sm font-semibold">{signal.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border bg-background p-3">
        <div className="mb-2 flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Latest cases</h3>
        </div>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open reports or escalations right now.</p>
        ) : (
          <div className="space-y-2">
            {reports.slice(0, 3).map((report) => (
              <Link
                key={report.id}
                href="/admin/reports"
                className="block rounded-md border px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold capitalize">
                    {report.category.replace(/_/g, " ")}
                  </p>
                  <Badge variant={report.severity === "high" ? "destructive" : "outline"}>
                    {report.severity}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.area || report.target_type} · {report.status.replace(/_/g, " ")}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function WorkstreamPanel({
  title,
  description,
  icon: Icon,
  items,
  locked,
  isPrimary,
  className,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  items: MetricItem[];
  locked: boolean;
  isPrimary: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-3 p-4 sm:p-5 ${className ?? ""}`}>
      <div className="flex items-start gap-3">
        <div
          className={`rounded-lg p-2 ${isPrimary ? "bg-primary text-primary-foreground" : "bg-muted"}`}
        >
          {locked ? <LockKeyhole className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {locked && <Badge variant="outline">handoff</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <WorkstreamRow key={item.label} item={item} locked={locked} />
        ))}
      </div>
    </div>
  );
}

function WorkstreamRow({ item, locked }: { item: MetricItem; locked: boolean }) {
  const content = (
    <>
      <span className="min-w-0">
        <span className="block font-medium">{item.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
      </span>
      <span className="shrink-0 font-semibold tabular-nums">{item.value}</span>
    </>
  );

  if (locked || !item.href) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm opacity-75">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/60"
    >
      {content}
    </Link>
  );
}

// ── 2. Area Dashboard Card (Mzansi Market / Business / Promos) ─

const AREA_CONFIG = {
  MZANSI_MARKET: {
    title: "Mzansi Market",
    description: "Listings — buy & sell items",
    icon: ShoppingBag,
    href: "/admin/mzansi-market",
    accentBg: "bg-brand-blue-50/50 dark:bg-brand-blue-950/20",
    iconBg: "bg-brand-blue-100 dark:bg-brand-blue-900/50",
    iconColor: "text-brand-blue-600 dark:text-brand-blue-400",
    ctaBg: "bg-brand-blue-600 hover:bg-brand-blue-700",
  },
  MZANSI_BUSINESS: {
    title: "Mzansi Business",
    description: "Business profiles & storefronts",
    icon: Building2,
    href: "/admin/businesses",
    accentBg: "bg-purple-50/50 dark:bg-purple-950/20",
    iconBg: "bg-purple-100 dark:bg-purple-900/50",
    iconColor: "text-purple-600 dark:text-purple-400",
    ctaBg: "bg-purple-600 hover:bg-purple-700",
  },
  PROMOTIONS_EVENTS: {
    title: "Tourism & Events",
    description: "Tourism businesses & events",
    icon: TreePalm,
    href: "/admin/tourism-events",
    accentBg: "bg-teal-50/50 dark:bg-teal-950/20",
    iconBg: "bg-teal-100 dark:bg-teal-900/50",
    iconColor: "text-teal-600 dark:text-teal-400",
    ctaBg: "bg-teal-600 hover:bg-teal-700",
  },
} as const;

interface AreaDashboardCardProps {
  area: keyof typeof AREA_CONFIG;
  stats: AreaSummaryStats;
  flagCount: number;
}

export function AreaDashboardCard({ area, stats, flagCount }: AreaDashboardCardProps) {
  const cfg = AREA_CONFIG[area];
  const Icon = cfg.icon;
  const topCat = stats.categoryBreakdown[0];
  const worstCat =
    stats.categoryBreakdown.length > 1
      ? stats.categoryBreakdown[stats.categoryBreakdown.length - 1]
      : null;

  return (
    <div className="rounded-xl border-2 border-border bg-card overflow-hidden">
      {/* Header */}
      <div className={`flex items-center gap-3 border-b px-4 py-3 ${cfg.accentBg}`}>
        <div className={`rounded-lg ${cfg.iconBg} p-2`}>
          <Icon className={`h-5 w-5 ${cfg.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold tracking-tight">{cfg.title}</h2>
          <p className="text-xs text-muted-foreground">{cfg.description}</p>
        </div>
        {stats.pendingReview > 0 && (
          <Badge variant="destructive" className="tabular-nums text-xs">
            {stats.pendingReview} to review
          </Badge>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Total posted", value: stats.totalPosted, icon: Zap },
            { label: "Live", value: stats.liveCount, icon: Eye },
            { label: "Pending", value: stats.pendingReview, icon: FileCheck },
            { label: "Rejected", value: stats.rejectedCount, icon: XCircle },
          ].map((s) => (
            <div key={s.label} className="text-center rounded-lg bg-muted/50 px-2 py-2">
              <p className="text-lg font-bold tabular-nums">{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {s.label}
              </p>
            </div>
          ))}
        </div>

        {/* Flags */}
        {flagCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-brand-red-50 dark:bg-brand-red-950/30 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-brand-red-500 flex-shrink-0" />
            <span className="text-xs text-brand-red-700 dark:text-brand-red-300 font-medium">
              {flagCount} open flag{flagCount > 1 ? "s" : ""} to resolve
            </span>
          </div>
        )}

        {/* Category performance */}
        {(topCat || worstCat) && (
          <div className="flex flex-wrap gap-3 text-xs">
            {topCat && (
              <span className="inline-flex items-center gap-1.5 text-brand-green-700 dark:text-brand-green-400">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-muted-foreground">Top:</span>
                <span className="font-semibold capitalize">
                  {topCat.category.replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground tabular-nums">({topCat.count})</span>
              </span>
            )}
            {worstCat && worstCat.category !== topCat?.category && (
              <span className="inline-flex items-center gap-1.5 text-brand-red-600 dark:text-brand-red-400">
                <TrendingDown className="h-3.5 w-3.5" />
                <span className="text-muted-foreground">Lowest:</span>
                <span className="font-semibold capitalize">
                  {worstCat.category.replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground tabular-nums">({worstCat.count})</span>
              </span>
            )}
          </div>
        )}

        {/* CTA */}
        <Link
          href={cfg.href}
          className={`inline-flex items-center gap-2 rounded-lg ${cfg.ctaBg} px-4 py-2 text-xs font-semibold text-white transition-colors w-full justify-center`}
        >
          Review {cfg.title}
          <ChevronRight className="h-3.5 w-3.5 ml-auto" />
        </Link>
      </div>
    </div>
  );
}
