import { redirect } from "next/navigation";
import Link from "next/link";
import { Eye, TrendingUp, MessageSquare, Package, BarChart3, Shuffle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { readFoundationPostPerformance } from "@/lib/foundation/post-performance";
import {
  readFoundationServerSession,
  readFoundationServerUser,
} from "@/lib/foundation/server-session";
import { SHOW_OWNER_METRICS } from "@/lib/hidden-features";

export const metadata = {
  title: "Metrics",
  description: "Track your listing views, leads, and performance metrics on VerifyMzansi.",
};

const ENGAGEMENT_METRICS: ReadonlyArray<[string, string]> = [
  ["impression", "Appearances in lists"],
  ["detail_view", "Detail views"],
  ["whatsapp_click", "WhatsApp clicks"],
  ["phone_click", "Phone clicks"],
  ["website_click", "Website clicks"],
  ["directions_click", "Directions clicks"],
  ["booking_click", "Booking clicks"],
  ["ticket_click", "Ticket clicks"],
  ["showroom_appearance", "Showroom appearances"],
  ["organisation_directory_appearance", "Organisation directory"],
  ["search_appearance", "Search appearances"],
  ["homepage_appearance", "Homepage appearances"],
  ["share", "Share actions"],
  ["save", "Saves"],
];

const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct or unknown",
  internal: "Within VerifyMzansi",
  search: "Search engines",
  social: "Social media",
  referral: "Other websites",
};

const AREA_LABELS: Record<string, string> = {
  market: "Mzansi Market",
  business: "Mzansi Business",
  tourism_events: "Tourism & Events",
};

type PostEngagement = {
  key: string;
  title: string;
  area: string;
  impressions: number;
  views: number;
  uniqueViewers: number;
  contacts: number;
  saves: number;
  shares: number;
};

type Engagement = {
  totals: Map<string, number>;
  uniqueViewers: number;
  posts: PostEngagement[];
  sources: Array<{ source: string; events: number }>;
};

const SHOWROOM_LABELS: Record<string, string> = {
  home: "Home showroom",
  business: "Mzansi Business showroom",
  market: "Mzansi Market showroom",
  tourism: "Tourism & Events showroom",
};

type FairShareRow = {
  key: string;
  title: string;
  surface: string;
  appearances: number;
  fairShare: number;
  eligiblePosts: number;
};

/**
 * The owner's figures from the live backend's one read
 * (api.get_my_post_performance, 20261121100028_post_performance_stats.sql):
 * the owner's own posts only. Views and engaged views are all time; the rest
 * covers the last 30 days, and showroom turns the last 7 days next to the fair
 * share (the average for every live post in that showroom).
 */
async function loadPerformance() {
  const { api } = await readFoundationServerSession();
  const performance = await readFoundationPostPerformance(api);
  const { unique_viewers: uniqueViewers, ...totals } = performance.last_30_days;
  const engagement: Engagement = {
    totals: new Map(Object.entries(totals)),
    uniqueViewers,
    posts: performance.top_posts.map((post) => ({
      key: post.post_id,
      title: post.title ?? "",
      area: AREA_LABELS[post.area] ?? "",
      impressions: post.appearances,
      views: post.views,
      uniqueViewers: post.unique_viewers,
      contacts: post.contacts,
      saves: post.saves,
      shares: post.shares,
    })),
    sources: performance.sources.map((row) => ({ source: row.source, events: row.views })),
  };
  const fairShare: FairShareRow[] = performance.showroom_turns
    .map((row) => ({
      key: `${row.surface}:${row.post_id}`,
      title: row.title || "Untitled post",
      surface: row.surface,
      appearances: row.appearances,
      fairShare: row.fair_share,
      eligiblePosts: row.eligible_posts,
    }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.surface.localeCompare(b.surface));
  return { performance, engagement, fairShare };
}

export default async function MetricsPage() {
  // Hidden until it works (src/lib/hidden-features.ts): old links lead to the dashboard.
  if (!SHOW_OWNER_METRICS) redirect("/dashboard");
  const user = await readFoundationServerUser();
  if (!user) redirect("/login");

  const { performance, engagement, fairShare } = await loadPerformance();
  const leadCount = performance.leads;
  const totalViews = performance.views;
  const engagedViews = performance.engaged_views;

  const conversionRate =
    totalViews > 0 ? (((leadCount || 0) / totalViews) * 100).toFixed(1) : "0.0";

  const engagementTotal = [...engagement.totals.values()].reduce((sum, n) => sum + n, 0);

  const stats = [
    {
      label: "Posts",
      value: performance.posts,
      icon: Package,
      description: `${performance.live_posts} live`,
      tone: "area-market-tile",
    },
    {
      label: "Views",
      value: totalViews.toLocaleString("en-ZA"),
      icon: Eye,
      description: `${engagedViews.toLocaleString("en-ZA")} engaged`,
      tone: "area-business-tile",
    },
    {
      label: "Leads",
      value: leadCount || 0,
      icon: MessageSquare,
      description: "Contact requests",
      tone: "bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200",
    },
    {
      label: "Lead rate",
      value: `${conversionRate}%`,
      icon: TrendingUp,
      description: "Leads per view",
      tone: "area-tourism-tile",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance"
        description="How your posts are doing."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Performance" }]}
      />

      {/* Stats Grid */}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <li
              key={stat.label}
              className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3.5 elev-xs sm:p-4"
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${stat.tone}`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-xl font-bold leading-none tabular-nums sm:text-2xl">
                  {stat.value}
                </span>
                <span className="mt-1 block truncate text-xs font-medium text-muted-foreground sm:text-sm">
                  {stat.label}
                  <span className="hidden sm:inline"> ({stat.description.toLowerCase()})</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle as="h2" className="flex items-center gap-2 text-lg">
            <BarChart3 aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
            Last 30 days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {engagementTotal === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
              <span aria-hidden="true" className="empty-state-icon">
                <BarChart3 className="h-6 w-6" />
              </span>
              <p className="mt-3 text-sm font-semibold text-foreground">No activity yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Views and clicks show here once people find your posts.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ENGAGEMENT_METRICS.map(([key, label]) => (
                  <div
                    key={key}
                    className="rounded-xl border border-border/70 bg-background/50 p-3"
                  >
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-display text-xl font-semibold tabular-nums">
                      {(engagement.totals.get(key) ?? 0).toLocaleString("en-ZA")}
                    </dd>
                  </div>
                ))}
                <div className="rounded-xl border border-border/70 bg-background/50 p-3">
                  <dt className="text-xs text-muted-foreground">Unique viewers</dt>
                  <dd className="font-display text-xl font-semibold tabular-nums">
                    {engagement.uniqueViewers.toLocaleString("en-ZA")}
                  </dd>
                </div>
              </dl>

              {engagement.posts.length > 0 ? (
                <section aria-labelledby="per-post-heading">
                  <h3 id="per-post-heading" className="mb-2 text-sm font-semibold">
                    By post
                  </h3>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {engagement.posts.map((post) => (
                      <li
                        key={post.key}
                        className="rounded-xl border border-border/70 bg-background/50 p-3"
                      >
                        <p className="truncate font-medium">{post.title || "Untitled post"}</p>
                        <p className="text-xs text-muted-foreground">{post.area}</p>
                        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          {(
                            [
                              ["Appearances", post.impressions],
                              ["Views", post.views],
                              ["Unique", post.uniqueViewers],
                              ["Contacts", post.contacts],
                              ["Saves", post.saves],
                              ["Share actions", post.shares],
                            ] as const
                          ).map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="font-semibold tabular-nums">
                                {value.toLocaleString("en-ZA")}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {engagement.sources.length > 0 ? (
                <section aria-labelledby="traffic-heading">
                  <h3 id="traffic-heading" className="mb-2 text-sm font-semibold">
                    Where detail views came from
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {engagement.sources.map((row) => (
                      <li
                        key={row.source}
                        className="flex justify-between gap-3 border-b border-border/60 py-2"
                      >
                        <span>{SOURCE_LABELS[row.source] ?? row.source}</span>
                        <span className="tabular-nums">{row.events.toLocaleString("en-ZA")}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
      {fairShare.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle as="h2" className="flex items-center gap-2 text-lg">
              <Shuffle aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
              Showroom turns, last 7 days
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Every live post gets a fair turn. Posts seen least go next, new posts get a 3-day head
              start, and visitors see posts from their own city and province first, mixed with the
              rest of South Africa. Likes help a little but never jump the queue.{" "}
              <Link href="/help/showroom" className="font-medium underline underline-offset-2">
                How the showroom works
              </Link>
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/60 text-sm">
              {fairShare.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{row.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {SHOWROOM_LABELS[row.surface] ?? row.surface} · {row.eligiblePosts} live posts
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="font-semibold">{row.appearances.toLocaleString("en-ZA")}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      times · fair share {row.fairShare.toLocaleString("en-ZA")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
