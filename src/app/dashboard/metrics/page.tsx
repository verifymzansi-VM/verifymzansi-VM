import { createClient } from "@/lib/supabase/server";
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

      {/* Placeholder for charts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5" />
            Views Over Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-32 flex items-center justify-center text-muted-foreground border rounded-lg">
            <div className="text-center">
              <BarChart3 className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No analytics data yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Views and engagement trends will appear here once your posts start receiving
                traffic.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
