import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight,
  ShieldCheck,
  ShoppingBag,
  Building2,
  Megaphone,
  TrendingUp,
  TrendingDown,
  Eye,
  FileCheck,
  XCircle,
  Zap,
} from "lucide-react";
import type { AreaSummaryStats } from "@/lib/utils/admin-queries";

// ── 1. Overview Strip (kept) ──────────────────────────────────

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

// ── 2. Verification Dashboard Card ────────────────────────────

interface VerificationCardProps {
  pendingVerifications: number;
  stepCounts?: { phone: number; id_doc: number; selfie: number; location: number };
}

export function VerificationCard({ pendingVerifications, stepCounts }: VerificationCardProps) {
  return (
    <div className="rounded-xl border-2 border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 border-b px-4 py-3 bg-brand-green-50/50 dark:bg-brand-green-950/20">
        <div className="rounded-lg bg-brand-green-100 dark:bg-brand-green-900/50 p-2">
          <ShieldCheck className="h-5 w-5 text-brand-green-600 dark:text-brand-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold tracking-tight">Verification (KYC)</h2>
          <p className="text-xs text-muted-foreground">Seller identity verification requests</p>
        </div>
        <Badge
          variant={pendingVerifications > 0 ? "destructive" : "secondary"}
          className="tabular-nums text-xs"
        >
          {pendingVerifications} pending
        </Badge>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Step breakdown */}
        {stepCounts && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Phone", value: stepCounts.phone },
              { label: "ID Doc", value: stepCounts.id_doc },
              { label: "Selfie", value: stepCounts.selfie },
              { label: "Location", value: stepCounts.location },
            ].map((s) => (
              <div key={s.label} className="text-center rounded-lg bg-muted/50 px-2 py-2">
                <p className="text-lg font-bold tabular-nums">{s.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <Link
          href="/admin/verification"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-green-700 transition-colors w-full justify-center"
        >
          <FileCheck className="h-4 w-4" />
          Review Verification Queue
          <ChevronRight className="h-3.5 w-3.5 ml-auto" />
        </Link>
      </div>
    </div>
  );
}

// ── 3. Area Dashboard Card (Mzansi Market / Business / Promos) ─

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
    title: "Promotions & Events",
    description: "Ads, deals, events & promotions",
    icon: Megaphone,
    href: "/admin/promotions-events",
    accentBg: "bg-amber-50/50 dark:bg-amber-950/20",
    iconBg: "bg-amber-100 dark:bg-amber-900/50",
    iconColor: "text-amber-600 dark:text-amber-400",
    ctaBg: "bg-amber-600 hover:bg-amber-700",
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
        <div className="grid grid-cols-4 gap-2">
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

// ── 4. Admin Controls (admin-only) — kept ─────────────────────

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
