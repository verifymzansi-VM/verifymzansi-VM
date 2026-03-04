import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";

// ── 1. Overview Strip ─────────────────────────────────────────

type HealthStatus = "healthy" | "warning" | "critical";

interface OverviewStripProps {
  status: HealthStatus;
  metrics: { label: string; value: string | number }[];
}

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

export function OverviewStrip({ status, metrics }: OverviewStripProps) {
  const cfg = STATUS_CONFIG[status];
  return (
    <div className={`rounded-xl border-2 border-border border-l-4 ${cfg.stripe} bg-card px-4 py-3`}>
      <div className="flex items-center gap-6 flex-wrap">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
          {cfg.label}
        </span>
        <span className="hidden sm:block h-4 w-px bg-border" />
        {metrics.map((m, i) => (
          <span key={m.label} className="inline-flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{m.label}</span>
            <span className="font-semibold tabular-nums">{m.value}</span>
            {i < metrics.length - 1 && <span className="ml-3 hidden sm:inline text-border">|</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── 2. Queue Mini-Card ────────────────────────────────────────

interface QueueMiniCardProps {
  label: string;
  count: number;
  href: string;
  capacity?: number;
  severityDots?: { breached: number; atRisk: number; onTrack: number };
}

export function QueueMiniCard({ label, count, href, capacity, severityDots }: QueueMiniCardProps) {
  const loadPct = capacity ? Math.min(100, Math.round((count / capacity) * 100)) : 0;
  const isHigh = capacity ? loadPct >= 60 : false;

  return (
    <Link
      href={href}
      className="block rounded-xl border-2 border-border bg-card p-3 hover:border-primary/40 hover:shadow-sm transition-all group"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Badge variant={count === 0 ? "secondary" : "outline"} className="tabular-nums text-[11px]">
          {count}
        </Badge>
      </div>

      {/* Middle: progress bar or severity dots */}
      {severityDots ? (
        <div className="flex items-center gap-3 mb-2 h-4">
          {severityDots.breached > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <span className="h-2 w-2 rounded-full bg-brand-red-500 flex-shrink-0" />
              <span className="tabular-nums font-medium text-destructive">
                {severityDots.breached}
              </span>
            </span>
          )}
          {severityDots.atRisk > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <span className="h-2 w-2 rounded-full bg-brand-gold-500 flex-shrink-0" />
              <span className="tabular-nums text-muted-foreground">{severityDots.atRisk}</span>
            </span>
          )}
          {severityDots.onTrack > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <span className="h-2 w-2 rounded-full bg-brand-green-500 flex-shrink-0" />
              <span className="tabular-nums text-muted-foreground">{severityDots.onTrack}</span>
            </span>
          )}
        </div>
      ) : capacity ? (
        <div className="mb-2 h-4 flex items-center">
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden w-full">
            <div
              className={`h-full rounded-full transition-all ${isHigh ? "bg-brand-gold-500" : "bg-brand-green-500"}`}
              style={{ width: `${loadPct}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="mb-2 h-4" />
      )}

      <div className="flex items-center justify-end">
        <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5">
          Go <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

// ── 3. Area Strip ─────────────────────────────────────────────

interface AreaItem {
  label: string;
  href: string;
  flags: number;
  pending: number;
}

export function AreaStrip({ areas }: { areas: AreaItem[] }) {
  return (
    <div className="rounded-xl border-2 border-border bg-muted/30 px-4 py-3">
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
        Marketplace Areas
      </h2>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {areas.map((area) => {
          const hasIssues = area.flags > 0 || area.pending > 0;
          return (
            <Link
              key={area.label}
              href={area.href}
              className="inline-flex items-center gap-2 text-xs hover:text-primary transition-colors"
            >
              {hasIssues && (
                <span className="h-1.5 w-1.5 rounded-full bg-brand-gold-500 flex-shrink-0" />
              )}
              <span className="font-medium">{area.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {area.flags > 0 && `${area.flags} flag${area.flags > 1 ? "s" : ""}`}
                {area.flags > 0 && area.pending > 0 && ", "}
                {area.pending > 0 && `${area.pending} pending`}
                {area.flags === 0 && area.pending === 0 && "clear"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── 4. Your Space (moderator zone) ────────────────────────────

interface YourSpaceProps {
  myActions: Record<string, number>;
  queueCounts: { kyc: number; reports: number; moderation: number };
}

export function YourSpace({ myActions, queueCounts }: YourSpaceProps) {
  const myTotal = Object.values(myActions).reduce((a, b) => a + b, 0);
  const myEntries = Object.entries(myActions).filter(([, v]) => v > 0);
  const summary =
    myEntries.length > 0
      ? myEntries.map(([a, c]) => `${c} ${a.replace(/_/g, " ")}`).join(", ")
      : "none yet";

  return (
    <div className="rounded-xl border-2 border-border bg-brand-green-50/50 dark:bg-brand-green-950/20 px-4 py-3 space-y-3">
      <div>
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Your Space
        </h2>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">{myTotal}</span> action
          {myTotal !== 1 ? "s" : ""} today — {summary}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {queueCounts.kyc > 0 && (
          <Link
            href="/admin/verification"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-green-700 transition-colors"
          >
            Review next KYC
            <Badge variant="secondary" className="text-[10px] bg-white/20 text-white border-0">
              {queueCounts.kyc}
            </Badge>
          </Link>
        )}
        {queueCounts.reports > 0 && (
          <Link
            href="/admin/reports"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-red-700 transition-colors"
          >
            Handle report
            <Badge variant="secondary" className="text-[10px] bg-white/20 text-white border-0">
              {queueCounts.reports}
            </Badge>
          </Link>
        )}
        {queueCounts.moderation > 0 && (
          <Link
            href="/admin/moderation"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-700 transition-colors"
          >
            Approve content
            <Badge variant="secondary" className="text-[10px] bg-white/20 text-white border-0">
              {queueCounts.moderation}
            </Badge>
          </Link>
        )}
        {queueCounts.kyc === 0 && queueCounts.reports === 0 && queueCounts.moderation === 0 && (
          <span className="text-xs text-muted-foreground italic">All queues clear</span>
        )}
      </div>
    </div>
  );
}

// ── 5. Admin Controls (admin-only) ────────────────────────────

interface AdminControlsProps {
  enforcementStats: { hidden: number; suspended: number; banned: number };
}

export function AdminControls({ enforcementStats }: AdminControlsProps) {
  return (
    <div className="rounded-xl border-2 border-border bg-brand-blue-50/50 dark:bg-brand-blue-950/20 px-4 py-3 space-y-3">
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Admin Controls
      </h2>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/admin/audit-log"
          className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
        >
          Audit Log
        </Link>
        <Link
          href="/admin/dsar"
          className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
        >
          Data Requests
        </Link>
        <Link
          href="/admin/feature-flags"
          className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
        >
          Feature Flags
        </Link>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <span className="text-muted-foreground">
          Hidden:{" "}
          <span
            className={`font-semibold tabular-nums ${enforcementStats.hidden > 0 ? "text-destructive" : ""}`}
          >
            {enforcementStats.hidden}
          </span>
        </span>
        <span className="text-muted-foreground">
          Suspended:{" "}
          <span
            className={`font-semibold tabular-nums ${enforcementStats.suspended > 0 ? "text-destructive" : ""}`}
          >
            {enforcementStats.suspended}
          </span>
        </span>
        <span className="text-muted-foreground">
          Banned:{" "}
          <span
            className={`font-semibold tabular-nums ${enforcementStats.banned > 0 ? "text-destructive" : ""}`}
          >
            {enforcementStats.banned}
          </span>
        </span>
      </div>
    </div>
  );
}
