export interface PerformanceReportData {
  period: { from: string; to: string };
  participatingBusinesses: number;
  activeBusinesses: number;
  sponsoredBusinesses: number;
  totalListings: number;
  events: Record<string, number>;
  profileViews: number;
  topCategories: Array<{ category: string | null; businesses: number }>;
  topLocations: Array<{ city: string | null; businesses: number }>;
  weeklyTrend: Array<{ week: string; views: number; contacts: number }>;
}

const METRICS: ReadonlyArray<[string, string]> = [
  ["impression", "Impressions"],
  ["search_appearance", "Search appearances"],
  ["detail_view", "Listing & profile views"],
  ["whatsapp_click", "WhatsApp clicks"],
  ["phone_click", "Phone clicks"],
  ["website_click", "Website clicks"],
  ["save", "Saves"],
  ["share", "Shares"],
  ["showroom_appearance", "Showroom appearances"],
  ["organisation_directory_appearance", "Directory appearances"],
];

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});

export function parsePerformanceReport(raw: unknown): PerformanceReportData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PerformanceReportData>;
  return {
    period: r.period ?? { from: new Date().toISOString(), to: new Date().toISOString() },
    participatingBusinesses: r.participatingBusinesses ?? 0,
    activeBusinesses: r.activeBusinesses ?? 0,
    sponsoredBusinesses: r.sponsoredBusinesses ?? 0,
    totalListings: r.totalListings ?? 0,
    events: r.events ?? {},
    profileViews: r.profileViews ?? 0,
    topCategories: r.topCategories ?? [],
    topLocations: r.topLocations ?? [],
    weeklyTrend: r.weeklyTrend ?? [],
  };
}

/** Partnership Performance Report: aggregate counts only, never viewer identities. */
export function PerformanceReport({
  organisationName,
  report,
}: {
  organisationName: string;
  report: PerformanceReportData;
}) {
  const maxWeek = Math.max(1, ...report.weeklyTrend.map((w) => w.views));
  return (
    <article
      className="space-y-5 rounded-xl border bg-card p-4 print:border-0 sm:p-6"
      aria-labelledby="report-title"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">
          VerifyMzansi Partnership Performance Report
        </p>
        <h2 id="report-title" className="font-display text-xl font-semibold">
          {organisationName}
        </h2>
        <p className="text-sm text-muted-foreground">
          {date.format(new Date(report.period.from))} – {date.format(new Date(report.period.to))}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Participating businesses", report.participatingBusinesses],
          ["Active businesses", report.activeBusinesses],
          ["Sponsored businesses", report.sponsoredBusinesses],
          ["Listings & posts", report.totalListings],
        ].map(([name, value]) => (
          <div key={String(name)} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{name}</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">
              {Number(value).toLocaleString("en-ZA")}
            </dd>
          </div>
        ))}
      </dl>

      <section>
        <h3 className="text-sm font-semibold">Discovery and engagement</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {METRICS.map(([key, name]) => (
            <div key={key} className="flex justify-between gap-2 border-b py-1">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="tabular-nums">{(report.events[key] ?? 0).toLocaleString("en-ZA")}</dd>
            </div>
          ))}
        </dl>
      </section>

      {report.weeklyTrend.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold">Weekly views</h3>
          <ul className="mt-2 space-y-1">
            {report.weeklyTrend.map((week) => (
              <li
                key={week.week}
                className="grid grid-cols-[6rem_1fr_4rem] items-center gap-2 text-xs"
              >
                <span className="text-muted-foreground">{date.format(new Date(week.week))}</span>
                <span className="h-2 rounded-full bg-muted" aria-hidden="true">
                  <span
                    className="block h-2 rounded-full bg-brand-green"
                    style={{ width: `${(week.views / maxWeek) * 100}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">
                  {week.views} / {week.contacts} contacts
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold">Top categories</h3>
          <ol className="mt-2 space-y-1 text-sm">
            {report.topCategories.map((row) => (
              <li key={row.category ?? "none"} className="flex justify-between">
                <span>{(row.category ?? "Uncategorised").replace(/_/g, " ")}</span>
                <span className="tabular-nums">{row.businesses}</span>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h3 className="text-sm font-semibold">Top locations</h3>
          <ol className="mt-2 space-y-1 text-sm">
            {report.topLocations.map((row) => (
              <li key={row.city ?? "none"} className="flex justify-between">
                <span>{row.city ?? "Unknown"}</span>
                <span className="tabular-nums">{row.businesses}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        Aggregated engagement only. No individual consumer data is included. The founding pilot
        carries no automatic charge; any continuation requires a new written agreement.
      </p>
    </article>
  );
}
