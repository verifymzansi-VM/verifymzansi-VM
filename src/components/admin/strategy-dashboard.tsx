import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HorizontalBarPanel,
  ColumnChartPanel,
  DecisionPanel,
} from "@/components/admin/intelligence-panels";
import {
  Users,
  Eye,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Flag,
  Inbox,
  Globe,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import type {
  AdminDashboardStats,
  ExtendedPlatformStats,
  SiteVisitStats,
  VerificationStepCounts,
} from "@/lib/utils/admin-queries";

// ── Shared bits ───────────────────────────────────────────────

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 }).format(value);
}

function formatDayLabel(dateKey: string, index: number, total: number) {
  if (index === total - 1) return "Today";
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

const AREA_LABELS: Record<string, string> = {
  home: "Home",
  mzansi_market: "Mzansi Market",
  mzansi_business: "Mzansi Business",
  promotions_events: "Tourism & Events",
  other: "Other public pages",
  shared_listings: "Listing details (all areas)",
};

// ── KPI card ──────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  subtext,
  icon: Icon,
  tone = "text-muted-foreground",
  href,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: LucideIcon;
  tone?: string;
  href?: string;
}) {
  const body = (
    <Card className={href ? "transition-colors hover:bg-muted/40" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${tone}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {subtext ? <p className="mt-1 text-xs text-muted-foreground">{subtext}</p> : null}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

// ── Traffic section ───────────────────────────────────────────

export function TrafficSection({ visits }: { visits: SiteVisitStats }) {
  if (!visits.available) {
    return (
      <section role="status" className="rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Website traffic unavailable</h2>
        <p className="text-xs text-muted-foreground">
          Traffic could not be loaded. Check the analytics migrations and database connection.
        </p>
      </section>
    );
  }
  const dailyData = visits.daily.map((point, i) => ({
    label: formatDayLabel(point.date, i, visits.daily.length),
    value: point.visits,
    caption: `${formatNumber(point.visitors)} visitors`,
    tone: "sky" as const,
  }));

  const pagesPerVisitor =
    visits.uniqueVisitors30d > 0 ? (visits.visits30d / visits.uniqueVisitors30d).toFixed(1) : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Website traffic</h2>
          <p className="text-xs text-muted-foreground">
            Estimated browsers on public pages. SAST calendar days; repeat views of the same page
            are counted at most once per 30 minutes. Cookies, devices and Do Not Track affect
            coverage.
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Globe className="h-3 w-3" /> Recorded traffic
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Visitors today"
          value={formatNumber(visits.uniqueVisitorsToday)}
          subtext={`${formatNumber(visits.visitsToday)} page views`}
          icon={Users}
          tone="text-sky-500"
        />
        <KpiCard
          label="Visitors (7 days)"
          value={formatNumber(visits.uniqueVisitors7d)}
          subtext={`${formatNumber(visits.visits7d)} page views`}
          icon={Users}
          tone="text-sky-500"
        />
        <KpiCard
          label="Visitors (30 days)"
          value={formatNumber(visits.uniqueVisitors30d)}
          subtext={`${formatNumber(visits.visits30d)} page views`}
          icon={TrendingUp}
          tone="text-emerald-500"
        />
        <KpiCard
          label="Engagement depth"
          value={pagesPerVisitor !== null ? `${pagesPerVisitor}` : "—"}
          subtext="Avg pages per visitor (30d)"
          icon={Eye}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ColumnChartPanel
          title="Daily visits — last 14 days"
          description="Page views per day. Watch the trend, not one day's spike."
          data={dailyData}
        />
        <div className="grid gap-4">
          <HorizontalBarPanel
            title="Top pages (30 days)"
            description="Where visitors spend attention — invest where traffic already is."
            data={visits.topPages.map((p) => ({
              label: p.path,
              value: p.visits,
              tone: "sky" as const,
            }))}
          />
          <HorizontalBarPanel
            title="Traffic by area (30 days)"
            description="Which marketplace areas attract the most visits."
            data={visits.byArea.map((a) => ({
              label: AREA_LABELS[a.area] ?? a.area,
              value: a.visits,
              tone: "violet" as const,
            }))}
          />
        </div>
      </div>
    </section>
  );
}

// ── Decisions-needed section ──────────────────────────────────

interface DecisionAction {
  label: string;
  count: number;
  detail: string;
  href: string;
  icon: LucideIcon;
  urgent: boolean;
}

export function DecisionsSection({
  stats,
  stepCounts,
  breachedReportCount,
  pendingContent,
}: {
  stats: AdminDashboardStats;
  stepCounts: VerificationStepCounts;
  breachedReportCount: number;
  pendingContent: number;
}) {
  const actions: DecisionAction[] = [
    {
      label: "Verify accounts",
      count: stats.pendingVerifications,
      detail:
        stats.pendingVerifications > 0
          ? `${stepCounts.id_doc} ID docs, ${stepCounts.selfie} selfies waiting`
          : "Queue is clear",
      href: "/admin/verification",
      icon: ShieldCheck,
      urgent: stats.pendingVerifications >= 30,
    },
    {
      label: "Review content",
      count: pendingContent,
      detail: pendingContent > 0 ? "New posts waiting for approval" : "Nothing to review",
      href: "/admin/moderation",
      icon: Clock,
      urgent: pendingContent >= 20,
    },
    {
      label: "Resolve reports",
      count: stats.openReports,
      detail:
        breachedReportCount > 0
          ? `${breachedReportCount} breached response SLA — act now`
          : stats.openReports > 0
            ? "Within response SLA"
            : "No open reports",
      href: "/admin/reports",
      icon: Flag,
      urgent: breachedReportCount > 0,
    },
    {
      label: "Answer support",
      count: stats.supportRequests,
      detail: stats.supportRequests > 0 ? "New contact requests" : "Inbox zero",
      href: "/admin/support",
      icon: Inbox,
      urgent: false,
    },
  ].sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.count - a.count);

  const totalOpen = actions.reduce((sum, a) => sum + a.count, 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Decisions needed today</h2>
          <p className="text-xs text-muted-foreground">
            Ordered by urgency — work down the list to keep the platform healthy.
          </p>
        </div>
        <Badge variant={totalOpen > 0 ? "secondary" : "outline"}>
          {totalOpen > 0 ? `${totalOpen} open` : "All clear"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.label}
              href={action.href}
              className={`group flex flex-col rounded-xl border p-4 transition-colors hover:bg-muted/50 ${
                action.urgent
                  ? "border-brand-red-300 bg-brand-red-50/40 dark:bg-brand-red-950/20"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon
                    className={`h-4 w-4 ${action.urgent ? "text-brand-red-500" : "text-muted-foreground"}`}
                  />
                  <p className="text-sm font-medium">{action.label}</p>
                </div>
                {action.urgent && (
                  <Badge variant="destructive" className="text-[10px]">
                    Urgent
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-3xl font-bold tabular-nums">{formatNumber(action.count)}</p>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{action.detail}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                Open queue
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── Growth & trust section ────────────────────────────────────

export function GrowthTrustSection({
  stats,
  extended,
  visits,
}: {
  stats: AdminDashboardStats;
  extended: ExtendedPlatformStats | null;
  visits: SiteVisitStats;
}) {
  const totalAccounts = stats.totalAccounts;
  const verified = extended?.verifiedAccounts ?? 0;
  const verifiedPct = totalAccounts > 0 ? Math.round((verified / totalAccounts) * 100) : 0;
  const liveContent = extended?.liveListings ?? 0;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Growth &amp; trust snapshot</h2>
        <p className="text-xs text-muted-foreground">
          The numbers management should watch week over week.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total accounts"
          value={formatNumber(totalAccounts)}
          subtext="Registered accounts, all time"
          icon={Users}
          href="/admin/intelligence/users"
        />
        <KpiCard
          label="Verified"
          value={`${verifiedPct}%`}
          subtext={`${formatNumber(verified)} verified accounts`}
          icon={CheckCircle2}
          tone="text-emerald-500"
          href="/admin/intelligence/verification"
        />
        <KpiCard
          label="Live content"
          value={formatNumber(liveContent)}
          subtext={`${formatNumber(extended?.hiddenListings ?? 0)} hidden records`}
          icon={Eye}
          tone="text-sky-500"
          href="/admin/intelligence/marketplace"
        />
        <KpiCard
          label="Banned / suspended"
          value={formatNumber((extended?.bannedAccounts ?? 0) + stats.activeSuspensions)}
          subtext={`${formatNumber(stats.activeSuspensions)} active suspensions`}
          icon={AlertTriangle}
          tone="text-amber-500"
          href="/admin/governance/enforcement"
        />
      </div>

      <DecisionPanel
        title="What these numbers mean"
        description="Plain-language read on the platform signal for decision-making."
        items={[
          {
            label: "Acquisition",
            value: visits.available
              ? `${formatNumber(visits.uniqueVisitors30d)} browsers`
              : "Unavailable",
            detail: !visits.available
              ? "Traffic could not be loaded; acquisition cannot be assessed."
              : visits.uniqueVisitors30d === 0
                ? "Tracking is live but no visits recorded yet — confirm the site_visits migration has been applied and public pages are reachable."
                : `${formatNumber(visits.uniqueVisitors30d)} estimated browsers visited public pages in the last 30 SAST calendar days. Grow this before increasing acquisition spend.`,
            tone: visits.uniqueVisitors30d > 0 ? "sky" : "amber",
          },
          {
            label: "Trust health",
            value: `${verifiedPct}% verified`,
            detail:
              verifiedPct >= 40
                ? "A healthy share of accounts is verified. Keep nudging unverified users — they are the cheapest growth lever."
                : "Verification adoption is low. Prioritise verification reminders before paid growth — unverified supply undermines marketplace trust.",
            tone: verifiedPct >= 40 ? "emerald" : "amber",
          },
          {
            label: "Content supply",
            value: `${formatNumber(liveContent)} live`,
            detail:
              liveContent > 0
                ? "Live content is what converts visitors into users. Watch top pages above to see which areas deserve more supply."
                : "No live content yet — seed listings in the areas that get the most traffic.",
            tone: liveContent > 0 ? "emerald" : "rose",
          },
        ]}
      />
    </section>
  );
}
