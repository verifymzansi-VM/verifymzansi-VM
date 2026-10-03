import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Eye, TrendingUp, MessageSquare, Package, BarChart3, Shuffle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { applyOwnerFilter, getOwnerColumn } from "@/lib/account/compat";
import { isVisibleByExpiry } from "@/lib/posting/visibility";

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

const CONTENT_TITLE: Record<string, { column: string; label: string }> = {
  listings: { column: "title", label: "Mzansi Market" },
  businesses: { column: "business_name", label: "Mzansi Business" },
  promotions: { column: "title", label: "Tourism & Events" },
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

const IMPRESSION_TYPES = new Set([
  "impression",
  "search_appearance",
  "homepage_appearance",
  "showroom_appearance",
  "organisation_directory_appearance",
]);
const CONTACT_TYPES = new Set([
  "whatsapp_click",
  "phone_click",
  "website_click",
  "directions_click",
  "booking_click",
  "ticket_click",
]);

/** Commercial analytics for the owner's posts (best effort; aggregates only). */
async function loadEngagement(ownerId: string): Promise<Engagement> {
  const result: Engagement = { totals: new Map(), uniqueViewers: 0, posts: [], sources: [] };
  try {
    const admin = tryCreateAdminClient();
    if (!admin) return result;
    const [summary, sources] = await Promise.all([
      admin.rpc("content_analytics_summary", { p_user: ownerId, p_days: 30 }),
      admin.rpc("content_traffic_sources", { p_user: ownerId, p_days: 30 }),
    ]);
    const rows = (summary.data ?? []) as Array<{
      content_table: string;
      content_id: string;
      event_type: string;
      events: number;
      unique_viewers: number;
    }>;
    const posts = new Map<string, PostEngagement>();
    for (const row of rows) {
      const events = Number(row.events);
      result.totals.set(row.event_type, (result.totals.get(row.event_type) ?? 0) + events);
      const key = `${row.content_table}:${row.content_id}`;
      const post = posts.get(key) ?? {
        key,
        title: "",
        area: CONTENT_TITLE[row.content_table]?.label ?? "",
        impressions: 0,
        views: 0,
        uniqueViewers: 0,
        contacts: 0,
        saves: 0,
        shares: 0,
      };
      if (IMPRESSION_TYPES.has(row.event_type)) post.impressions += events;
      if (CONTACT_TYPES.has(row.event_type)) post.contacts += events;
      if (row.event_type === "detail_view") {
        post.views += events;
        post.uniqueViewers += Number(row.unique_viewers);
        result.uniqueViewers += Number(row.unique_viewers);
      }
      if (row.event_type === "save") post.saves += events;
      if (row.event_type === "share") post.shares += events;
      posts.set(key, post);
    }

    const top = [...posts.values()]
      .sort(
        (a, b) => b.views + b.contacts - (a.views + a.contacts) || b.impressions - a.impressions
      )
      .slice(0, 10);
    await Promise.all(
      Object.entries(CONTENT_TITLE).map(async ([table, { column }]) => {
        const ids = top
          .filter((post) => post.key.startsWith(`${table}:`))
          .map((post) => post.key.slice(table.length + 1));
        if (ids.length === 0) return;
        const { data } = await admin.from(table).select(`id, ${column}`).in("id", ids);
        for (const row of (data ?? []) as unknown as Array<Record<string, string | null>>) {
          const post = top.find((item) => item.key === `${table}:${row.id}`);
          if (post) post.title = row[column] ?? "";
        }
      })
    );
    result.posts = top;
    result.sources = (
      (sources.data ?? []) as Array<{ traffic_source: string; events: number }>
    ).map((row) => ({ source: row.traffic_source, events: Number(row.events) }));
  } catch {
    // Analytics are informational only.
  }
  return result;
}

type OwnedRow = {
  id: string;
  expires_at?: string | null;
  created_at?: string | null;
  title?: string | null;
  business_name?: string | null;
  status?: string | null;
  view_count?: number | null;
  engaged_view_count?: number | null;
};

type OwnedPost = {
  table: "listings" | "businesses" | "promotions";
  id: string;
  title: string;
  live: boolean;
  views: number;
  engagedViews: number;
};

function toOwnedPost(table: OwnedPost["table"], row: OwnedRow): OwnedPost {
  return {
    table,
    id: row.id,
    title: row.business_name ?? row.title ?? "",
    // Live and still inside its paid (or legacy free) window, as the public sees it.
    live: row.status === "live" && isVisibleByExpiry(row.expires_at, new Date(), row.created_at),
    views: row.view_count ?? 0,
    engagedViews: row.engaged_view_count ?? 0,
  };
}

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
 * Each live post's showroom appearances this week next to the fair share
 * (the average for every live post in that showroom), so owners can see the
 * rotation treats them equally.
 */
async function loadShowroomFairShare(posts: OwnedPost[]): Promise<FairShareRow[]> {
  if (posts.length === 0) return [];
  try {
    const admin = tryCreateAdminClient();
    if (!admin) return [];
    const { data, error } = await admin.rpc("get_showroom_fair_share", {
      p_ids: posts.map((post) => post.id),
    });
    if (error || !Array.isArray(data)) return [];
    return (
      data as Array<{
        surface: string;
        content_id: string;
        appearances_7d: number;
        fair_share_7d: number | null;
        eligible_posts: number;
      }>
    )
      .map((row) => ({
        key: `${row.surface}:${row.content_id}`,
        title: posts.find((post) => post.id === row.content_id)?.title || "Untitled post",
        surface: row.surface,
        appearances: Number(row.appearances_7d) || 0,
        fairShare: Number(row.fair_share_7d) || 0,
        eligiblePosts: Number(row.eligible_posts) || 0,
      }))
      .sort((a, b) => a.title.localeCompare(b.title) || a.surface.localeCompare(b.surface));
  } catch {
    return [];
  }
}

export default async function MetricsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Use user.id directly — listings.owner_id references auth.users(id)
  const ownerId = user.id;
  const [listingOwnerColumn, contactOwnerColumn, promotionOwnerColumn] = await Promise.all([
    getOwnerColumn(supabase, "listings"),
    getOwnerColumn(supabase, "contact_events"),
    getOwnerColumn(supabase, "promotions"),
  ]);

  // Fetch stats
  const [
    { data: viewData },
    { count: leadCount },
    { data: businessViewData },
    { data: promotionViewData },
  ] = await Promise.all([
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("id, title, status, expires_at, created_at, view_count, engaged_view_count"),
      listingOwnerColumn,
      ownerId
    ),
    applyOwnerFilter(
      supabase.from("contact_events").select("*", { count: "exact", head: true }),
      contactOwnerColumn,
      ownerId
    ),
    supabase
      .from("businesses")
      .select("id, business_name, status, expires_at, created_at, view_count, engaged_view_count")
      .eq("owner_id", ownerId),
    applyOwnerFilter(
      supabase
        .from("promotions")
        .select("id, title, status, expires_at, created_at, view_count, engaged_view_count"),
      promotionOwnerColumn,
      ownerId
    ),
  ]);

  // Every post the owner has, not only Market listings: business and Tourism &
  // Events owners used to see 0 views here.
  const ownedPosts: OwnedPost[] = [
    ...((viewData ?? []) as OwnedRow[]).map((row) => toOwnedPost("listings", row)),
    ...((businessViewData ?? []) as OwnedRow[]).map((row) => toOwnedPost("businesses", row)),
    ...((promotionViewData ?? []) as OwnedRow[]).map((row) => toOwnedPost("promotions", row)),
  ];
  const totalViews = ownedPosts.reduce((sum, post) => sum + post.views, 0);
  const engagedViews = ownedPosts.reduce((sum, post) => sum + post.engagedViews, 0);
  const fairShare = await loadShowroomFairShare(ownedPosts.filter((post) => post.live));

  const conversionRate =
    totalViews > 0 ? (((leadCount || 0) / totalViews) * 100).toFixed(1) : "0.0";

  const engagement = await loadEngagement(ownerId);
  const engagementTotal = [...engagement.totals.values()].reduce((sum, n) => sum + n, 0);

  const stats = [
    {
      label: "Posts",
      value: ownedPosts.length,
      icon: Package,
      description: `${ownedPosts.filter((post) => post.live).length} live`,
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
              Everyone gets an equal turn. Posts seen least go next, new posts get 72 hours up
              front, and visitors see posts from their own province first.{" "}
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
