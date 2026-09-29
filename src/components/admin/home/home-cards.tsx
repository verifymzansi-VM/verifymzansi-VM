import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format";
import type { StaffDashboard } from "@/lib/services/staff-dashboard";

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
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  href,
  urgent = false,
}: {
  label: string;
  value: number | null | undefined;
  detail?: React.ReactNode;
  href?: string;
  /** Highlight when the value is above zero. */
  urgent?: boolean;
}) {
  const available = typeof value === "number";
  const alarming = urgent && available && value > 0;
  const body = (
    <div
      className={cn(
        "flex h-full flex-col gap-1 rounded-xl border bg-card p-4 transition-colors",
        href && "hover:bg-muted/40",
        alarming && "border-destructive/40 bg-destructive/5"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {href && (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums",
          !available && "text-base font-medium text-muted-foreground",
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
      className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

export function oldestLabel(oldestAt: string | null | undefined): string | null {
  return oldestAt ? `Oldest arrived ${formatRelativeTime(oldestAt)}` : null;
}

/** The four work queues, with size, age and pressure. */
export function QueueOverview({ queues }: { queues: StaffDashboard["queues"] }) {
  const { reports, kyc, content, support } = queues;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Open reports"
        value={reports?.open}
        href="/admin/reports"
        urgent={Boolean(reports && reports.breached > 0)}
        detail={
          reports && (
            <>
              {reports.breached > 0 ? (
                <span className="font-medium text-destructive">
                  {formatCount(reports.breached)} past their deadline
                </span>
              ) : (
                "All within their deadline"
              )}
              {reports.claimed > 0 && ` · ${formatCount(reports.claimed)} being worked`}
              {oldestLabel(reports.oldest_at) && <p>{oldestLabel(reports.oldest_at)}</p>}
            </>
          )
        }
      />
      <StatCard
        label="Identity checks"
        value={kyc?.pending}
        href="/admin/verification"
        detail={
          kyc && (
            <>
              {kyc.high_risk > 0 ? `${formatCount(kyc.high_risk)} high risk` : "None high risk"}
              {kyc.claimed > 0 && ` · ${formatCount(kyc.claimed)} being worked`}
              {oldestLabel(kyc.oldest_at) && <p>{oldestLabel(kyc.oldest_at)}</p>}
            </>
          )
        }
      />
      <StatCard
        label="Content to review"
        value={content?.pending}
        href="/admin/moderation"
        detail={
          content && (
            <>
              {content.claimed > 0
                ? `${formatCount(content.claimed)} being worked`
                : "None claimed"}
              {oldestLabel(content.oldest_at) && <p>{oldestLabel(content.oldest_at)}</p>}
            </>
          )
        }
      />
      <StatCard
        label="New support requests"
        value={support?.new}
        href="/admin/support"
        detail={support && oldestLabel(support.oldest_at)}
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
