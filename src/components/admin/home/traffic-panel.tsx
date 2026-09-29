import { TrendingUp, Users, Eye } from "lucide-react";
import { ColumnChartPanel, HorizontalBarPanel } from "@/components/admin/intelligence-panels";
import { getSiteVisitStats } from "@/lib/utils/admin-queries";
import { formatCount, SectionHeading } from "./home-cards";

const AREA_LABELS: Record<string, string> = {
  home: "Home",
  mzansi_market: "Mzansi Market",
  mzansi_business: "Mzansi Business",
  promotions_events: "Tourism & Events",
  other: "Other public pages",
  shared_listings: "Listing details (all areas)",
};

/** Bars are narrow, so each gets the day of the month; the description names the range. */
function dayLabel(dateKey: string) {
  return String(new Date(`${dateKey}T00:00:00`).getDate());
}

function dayRange(daily: { date: string }[]): string {
  if (daily.length === 0) return "";
  const first = new Date(`${daily[0].date}T00:00:00`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
  });
  return `${first} to today`;
}

const PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/mzansi-market": "Mzansi Market",
  "/mzansi-business": "Mzansi Business",
  "/tourism-events": "Tourism & Events",
  "/pricing": "Pricing",
  "/advertise": "Advertise",
  "/trust-safety": "Trust & Safety",
  "/safety": "Safety Centre",
  "/search": "Search",
  "/contact": "Contact",
  "/verify-buyer": "Verify a buyer",
  "/privacy": "Privacy policy",
  "/terms": "Terms of service",
  "/login": "Sign in",
  "/register": "Register",
};

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Readable name for a visited path; single posts show their area and a short ID. */
function pageLabel(path: string): string {
  if (PAGE_LABELS[path]) return PAGE_LABELS[path];
  const segments = path.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  if (UUID_SEGMENT.test(last)) {
    const parent = `/${segments.slice(0, -1).join("/")}`;
    const area = PAGE_LABELS[parent] ?? "Post";
    return `${area} post ${last.slice(0, 6)}`;
  }
  return path;
}

function Figure({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

/** Website traffic for admins. Streamed separately so it never holds up the home page. */
export async function TrafficPanel() {
  const visits = await getSiteVisitStats();
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
  const pagesPerVisitor =
    visits.uniqueVisitors30d > 0 ? (visits.visits30d / visits.uniqueVisitors30d).toFixed(1) : "—";

  return (
    <section className="space-y-3" aria-labelledby="home-traffic">
      <div id="home-traffic">
        <SectionHeading
          title="Website traffic"
          description="Public pages only, counted by South African day. Visitors are estimated per browser, and repeat views of a page within 30 minutes count once."
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Visitors today"
          value={formatCount(visits.uniqueVisitorsToday)}
          detail={`${formatCount(visits.visitsToday)} page views`}
          icon={Users}
        />
        <Figure
          label="Visitors, 7 days"
          value={formatCount(visits.uniqueVisitors7d)}
          detail={`${formatCount(visits.visits7d)} page views`}
          icon={Users}
        />
        <Figure
          label="Visitors, 30 days"
          value={formatCount(visits.uniqueVisitors30d)}
          detail={`${formatCount(visits.visits30d)} page views`}
          icon={TrendingUp}
        />
        <Figure
          label="Pages per visitor"
          value={pagesPerVisitor}
          detail="Average over 30 days"
          icon={Eye}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ColumnChartPanel
          title="Daily page views, last 14 days"
          description={`Page views per day, ${dayRange(visits.daily)}.`}
          data={visits.daily.map((point) => ({
            label: dayLabel(point.date),
            value: point.visits,
            caption: `${formatCount(point.visitors)} visitors`,
            tone: "sky" as const,
          }))}
        />
        <div className="grid gap-4">
          <HorizontalBarPanel
            title="Most viewed pages, 30 days"
            description="Page views per page."
            data={visits.topPages.map((p) => ({
              label: pageLabel(p.path),
              value: p.visits,
              tone: "sky" as const,
            }))}
          />
          <HorizontalBarPanel
            title="Page views by area, 30 days"
            description="Which parts of the site people visit most."
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

export function TrafficPanelSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading website traffic">
      <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
