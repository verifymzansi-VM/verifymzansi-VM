import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, ArrowRight, type LucideIcon } from "lucide-react";

// ── Alert Banner ──────────────────────────────────────────────

interface AlertItem {
  message: string;
  href: string;
  severity: "critical" | "warning";
}

export function DashboardAlerts({ alerts }: { alerts: AlertItem[] }) {
  if (!alerts.length) return null;

  const hasCritical = alerts.some((a) => a.severity === "critical");
  return (
    <div
      className={`rounded-lg border p-4 space-y-1.5 ${
        hasCritical
          ? "border-destructive/50 bg-destructive/5"
          : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
      }`}
    >
      <p
        className={`text-sm font-semibold flex items-center gap-2 ${
          hasCritical ? "text-destructive" : "text-amber-700 dark:text-amber-400"
        }`}
      >
        <AlertTriangle className="h-4 w-4" />
        Requires Attention
      </p>
      {alerts.map((alert, i) => (
        <Link
          key={i}
          href={alert.href}
          className={`text-sm block pl-6 hover:underline ${
            alert.severity === "critical"
              ? "text-destructive/90"
              : "text-amber-700/90 dark:text-amber-400/90"
          }`}
        >
          {alert.message}
        </Link>
      ))}
    </div>
  );
}

// ── Queue Card (clickable link to sub-page) ───────────────────

export function QueueCard({
  icon: Icon,
  label,
  count,
  href,
  subtitle,
  urgent,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  href: string;
  subtitle?: string;
  urgent?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div
                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 ${
                  urgent
                    ? "bg-destructive/10 text-destructive"
                    : count > 0
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                      : "bg-primary/10 text-primary"
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold font-display tabular-nums">{count}</p>
                <p className="text-xs font-medium">{label}</p>
                {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground mt-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ── Compact stat line (for platform health row) ───────────────

export function StatLine({
  items,
}: {
  items: { label: string; value: number | string; warn?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">{item.label}:</span>
          <span className={`font-semibold tabular-nums ${item.warn ? "text-destructive" : ""}`}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
