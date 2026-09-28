import { Globe, TrendingUp, Users, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

function dayLabel(dateKey: string, index: number, total: number) {
  if (index === total - 1) return "Today";
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
  });
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
      <div id="home-traffic" className="flex flex-wrap items-start justify-between gap-2">
        <SectionHeading
          title="Website traffic"
          description="Estimated browsers on public pages, by South African calendar day. Repeat views of a page count once per 30 minutes."
        />
        <Badge variant="outline" className="gap-1">
          <Globe className="h-3 w-3" aria-hidden="true" /> Recorded traffic
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Visitors today"
          value={formatCount(visits.uniqueVisitorsToday)}
          detail={`${formatCount(visits.visitsToday)} page views`}
          icon={Users}
        />
        <Figure
          label="Visitors (7 days)"
          value={formatCount(visits.uniqueVisitors7d)}
          detail={`${formatCount(visits.visits7d)} page views`}
          icon={Users}
        />
        <Figure
          label="Visitors (30 days)"
          value={formatCount(visits.uniqueVisitors30d)}
          detail={`${formatCount(visits.visits30d)} page views`}
          icon={TrendingUp}
        />
        <Figure
          label="Pages per visitor"
          value={pagesPerVisitor}
          detail="Average, 30 days"
          icon={Eye}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ColumnChartPanel
          title="Daily visits, last 14 days"
          description="Page views per day."
          data={visits.daily.map((point, i) => ({
            label: dayLabel(point.date, i, visits.daily.length),
            value: point.visits,
            caption: `${formatCount(point.visitors)} visitors`,
            tone: "sky" as const,
          }))}
        />
        <div className="grid gap-4">
          <HorizontalBarPanel
            title="Top pages (30 days)"
            description="Where visitors spend their time."
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
