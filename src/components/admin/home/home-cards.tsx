import Link from "next/link";
import { CheckCircle2, ChevronRight, Clock, Flag, IdCard, Inbox, ScanEye } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";
import type { StaffDashboard } from "@/lib/services/staff-dashboard";
import { isStale } from "./attention";

/**
 * Building blocks for the staff home pages. A value of null or undefined
 * means it could not be read, and shows as "Unavailable", never as 0.
 */

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 0 }).format(value);
}

export function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  href,
  icon: Icon,
  urgent = false,
}: {
  label: string;
  value: number | null | undefined;
  detail?: React.ReactNode;
  href?: string;
  icon?: React.ElementType;
  /** Highlight in red when the value is above zero. */
  urgent?: boolean;
}) {
  const available = typeof value === "number";
  const alarming = urgent && available && value > 0;
  // Zero recedes so the cards with work stand out; work gets the gold edge.
  const clear = available && value === 0;
  const busy = available && value > 0 && !alarming;
  const body = (
    <div
      className={cn(
        "relative flex h-full flex-col gap-1 overflow-hidden rounded-xl border bg-card p-3 transition-colors sm:p-4",
        href && "group-hover:border-foreground/20 group-hover:bg-muted/40",
        clear && "bg-card/60",
        busy && "border-brand-gold-300/60 shadow-sm dark:border-brand-gold-300/30",
        alarming && "border-destructive/40 bg-destructive/5"
      )}
    >
      {(busy || alarming) && (
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-1",
            alarming ? "bg-destructive" : "bg-brand-gold-400"
          )}
          aria-hidden="true"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
          {Icon && (
            <span
              className={cn(
                "hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:flex",
                busy
                  ? "bg-brand-gold-100 text-brand-gold-800 dark:bg-brand-gold-300/15 dark:text-brand-gold-200"
                  : alarming
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
              )}
              aria-hidden="true"
            >
              <Icon className="h-4 w-4" />
            </span>
          )}
          <span className="min-w-0">{label}</span>
        </p>
        {href && (
          <ChevronRight
            className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        )}
      </div>
      <p
        className={cn(
          "font-display text-3xl font-bold tabular-nums tracking-tight",
          !available && "font-sans text-base font-medium tracking-normal text-muted-foreground",
          clear && "text-muted-foreground/60",
          alarming && "text-destructive"
        )}
      >
        {available ? formatCount(value) : "Unavailable"}
      </p>
      {available && detail && <div className="text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

export type MetricRow = {
  label: string;
  /** A number, or a short status word such as "Running". Null or undefined reads as "Unavailable". */
  value: number | string | null | undefined;
  detail?: React.ReactNode;
  href?: string;
  /** Highlight when a numeric value is above zero. */
  urgent?: boolean;
  /** Force the highlight, for status values. */
  alarming?: boolean;
};

/**
 * Several related figures in one card, one row each. Used for side panels
 * where a card per number would waste space.
 */
export function MetricList({
  id,
  title,
  description,
  rows,
  summarise = false,
}: {
  id: string;
  title: string;
  description?: string;
  rows: MetricRow[];
  /** Show an "All normal" or "N need attention" chip, counting the urgent and alarming rows. */
  summarise?: boolean;
}) {
  const flagged = rows.filter(
    (row) => row.alarming || (row.urgent && typeof row.value === "number" && row.value > 0)
  ).length;
  const unknown = rows.some((row) => row.value === null || row.value === undefined);
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {summarise && (flagged > 0 || !unknown) && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
              flagged > 0
                ? "bg-destructive/10 text-destructive"
                : "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-300/10 dark:text-brand-green-300"
            )}
          >
            {flagged > 0 ? (
              `${formatCount(flagged)} need${flagged === 1 ? "s" : ""} attention`
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                All normal
              </>
            )}
          </span>
        )}
      </div>
      <ul className="divide-y">
        {rows.map((row) => {
          const available = row.value !== null && row.value !== undefined;
          const alarming =
            row.alarming || (row.urgent && typeof row.value === "number" && row.value > 0);
          const content = (
            <>
              <div className="min-w-0">
                <p className="text-sm">{row.label}</p>
                {available && row.detail && (
                  <div className="text-xs text-muted-foreground">{row.detail}</div>
                )}
              </div>
              <span
                className={cn(
                  "shrink-0 text-lg font-bold tabular-nums",
                  typeof row.value === "string" && "text-sm",
                  row.value === 0 && "font-semibold text-muted-foreground/60",
                  !available && "text-sm font-medium text-muted-foreground",
                  alarming && "text-destructive"
                )}
              >
                {!available
                  ? "Unavailable"
                  : typeof row.value === "number"
                    ? formatCount(row.value)
                    : row.value}
              </span>
            </>
          );
          return (
            <li key={row.label}>
              {row.href ? (
                <Link
                  href={row.href}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {content}
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function oldestLabel(oldestAt: string | null | undefined): string | null {
  return oldestAt ? `Oldest arrived ${formatRelativeTime(oldestAt)}` : null;
}

/** "Oldest arrived …", called out when the oldest item has waited more than two days. */
export function OldestLine({ at }: { at: string | null | undefined }) {
  if (!at) return null;
  const relative = formatRelativeTime(at);
  return isStale(at) ? (
    <p className="mt-0.5 inline-flex items-center gap-1 font-medium text-brand-gold-800 dark:text-brand-gold-300">
      <Clock className="h-3 w-3" aria-hidden="true" />
      {relative.endsWith(" ago")
        ? `Oldest has waited ${relative.slice(0, -4)}`
        : `Oldest waiting since ${relative}`}
    </p>
  ) : (
    <p>{oldestLabel(at)}</p>
  );
}

/** The four work queues, with size, age and pressure. */
export function QueueOverview({ queues }: { queues: StaffDashboard["queues"] }) {
  const { reports, kyc, content, support } = queues;
  return (
    <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
      <StatCard
        label="Open reports"
        icon={Flag}
        value={reports?.open}
        href="/admin/reports"
        urgent={Boolean(reports && reports.breached > 0)}
        detail={
          reports && (
            <>
              {reports.open === 0 ? (
                "Nothing waiting"
              ) : reports.breached > 0 ? (
                <span className="font-medium text-destructive">
                  {formatCount(reports.breached)} past their deadline
                </span>
              ) : (
                "All within their deadline"
              )}
              {reports.claimed > 0 && ` · ${formatCount(reports.claimed)} being worked`}
              <OldestLine at={reports.oldest_at} />
            </>
          )
        }
      />
      <StatCard
        label="Identity checks"
        icon={IdCard}
        value={kyc?.pending}
        href="/admin/verification"
        detail={
          kyc && (
            <>
              {kyc.pending === 0
                ? "Nothing waiting"
                : kyc.high_risk > 0
                  ? `${formatCount(kyc.high_risk)} high risk`
                  : "None high risk"}
              {kyc.claimed > 0 && ` · ${formatCount(kyc.claimed)} being worked`}
              <OldestLine at={kyc.oldest_at} />
            </>
          )
        }
      />
      <StatCard
        label="Content to review"
        icon={ScanEye}
        value={content?.pending}
        href="/admin/moderation"
        detail={
          content && (
            <>
              {content.pending === 0
                ? "Nothing waiting"
                : content.claimed > 0
                  ? `${formatCount(content.claimed)} being worked`
                  : "None claimed yet"}
              <OldestLine at={content.oldest_at} />
            </>
          )
        }
      />
      <StatCard
        label="New support requests"
        icon={Inbox}
        value={support?.new}
        href="/admin/support"
        detail={
          support && (support.new === 0 ? "Nothing waiting" : <OldestLine at={support.oldest_at} />)
        }
      />
    </div>
  );
}

export function DashboardUnavailable() {
  return (
    <p role="alert" className="rounded-xl border p-4 text-sm">
      Your home page could not be loaded. Refresh to try again, or open a queue from the menu. This
      does not mean the queues are empty.
    </p>
  );
}
