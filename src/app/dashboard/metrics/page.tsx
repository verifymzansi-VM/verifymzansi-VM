import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { Eye, TrendingUp, MessageSquare, Package, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { applyOwnerFilter, getOwnerColumn } from "@/lib/account/compat";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";

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
  ["showroom_appearance", "Showroom appearances"],
  ["organisation_directory_appearance", "Organisation directory"],
  ["share", "Shares"],
];

/** Per-type totals of commercial analytics for the owner's posts (best effort). */
async function loadEngagement(ownerId: string): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  try {
    const admin = tryCreateAdminClient();
    if (!admin) return totals;
    const { data } = await admin.rpc("content_analytics_summary", { p_user: ownerId, p_days: 30 });
    for (const row of (data ?? []) as Array<{ event_type: string; events: number }>) {
      totals.set(row.event_type, (totals.get(row.event_type) ?? 0) + Number(row.events));
    }
  } catch {
    // Analytics are informational only.
  }
  return totals;
}

export default async function MetricsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Use user.id directly — listings.owner_id references auth.users(id)
  const ownerId = user.id;
  const [listingOwnerColumn, contactOwnerColumn] = await Promise.all([
    getOwnerColumn(supabase, "listings"),
    getOwnerColumn(supabase, "contact_events"),
  ]);

  // Fetch stats
  const [
    { count: activeListings },
    { data: viewData },
    { count: leadCount },
    { count: totalListings },
  ] = await Promise.all([
    applyOwnerFilter(
      applyVisibleExpiryFilter(
        supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "live")
      ),
      listingOwnerColumn,
      ownerId
    ),
    applyOwnerFilter(supabase.from("listings").select("view_count"), listingOwnerColumn, ownerId),
    applyOwnerFilter(
      supabase.from("contact_events").select("*", { count: "exact", head: true }),
      contactOwnerColumn,
      ownerId
    ),
    applyOwnerFilter(
      supabase.from("listings").select("*", { count: "exact", head: true }),
      listingOwnerColumn,
      ownerId
    ),
  ]);

  const totalViews =
    viewData?.reduce(
      (sum: number, l: { view_count: number | null }) => sum + (l.view_count || 0),
      0
    ) || 0;

  const conversionRate =
    totalViews > 0 ? (((leadCount || 0) / totalViews) * 100).toFixed(1) : "0.0";

  const engagement = await loadEngagement(ownerId);
  const engagementTotal = [...engagement.values()].reduce((sum, n) => sum + n, 0);

  const stats = [
    {
      label: "Total Listings",
      value: totalListings || 0,
      icon: Package,
      description: `${activeListings || 0} active`,
    },
    {
      label: "Total Views",
      value: totalViews.toLocaleString(),
      icon: Eye,
      description: "Across all listings",
    },
    {
      label: "Leads Received",
      value: leadCount || 0,
      icon: MessageSquare,
      description: "Contact requests",
    },
    {
      label: "Conversion Rate",
      value: `${conversionRate}%`,
      icon: TrendingUp,
      description: "Views → Leads",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance Metrics"
        description="Track your listing performance."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Metrics" }]}
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold font-display">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5" />
            Engagement — last 30 days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {engagementTotal === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-lg border text-muted-foreground">
              <div className="text-center">
                <BarChart3 className="mx-auto mb-3 h-8 w-8 opacity-50" />
                <p className="text-sm font-medium">No analytics data yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Views and engagement trends will appear here once your posts start receiving
                  traffic.
                </p>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ENGAGEMENT_METRICS.map(([key, label]) => (
                <div key={key} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-display text-xl font-semibold tabular-nums">
                    {(engagement.get(key) ?? 0).toLocaleString("en-ZA")}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
