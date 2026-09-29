import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ColumnChartPanel,
  DecisionPanel,
  HorizontalBarPanel,
} from "@/components/admin/intelligence-panels";
import { TrendingUp, Calendar, BarChart3, Activity } from "lucide-react";

export const metadata = {
  title: "Trends",
  description: "Platform activity trends over time.",
};

export default async function IntelligenceTrendsPage() {
  await requireStaff("bi:view");

  const admin = createAdminClient();

  // Fetch recent activity for trend indicators
  const now = new Date();
  const thirtyDaysAgoDate = new Date(now);
  const sevenDaysAgoDate = new Date(now);
  thirtyDaysAgoDate.setDate(now.getDate() - 30);
  sevenDaysAgoDate.setDate(now.getDate() - 7);
  const thirtyDaysAgo = thirtyDaysAgoDate.toISOString();
  const sevenDaysAgo = sevenDaysAgoDate.toISOString();

  const [
    { count: signups30d },
    { count: signups7d },
    { count: verifications30d },
    { count: listings30d },
    { count: businesses30d },
    { count: promotions30d },
  ] = await Promise.all([
    admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("*", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("*", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
    admin
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    admin
      .from("listings")
      .select("*", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    admin
      .from("businesses")
      .select("*", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    admin
      .from("promotions")
      .select("*", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
  ]);

  const s30 = signups30d ?? 0;
  const s7 = signups7d ?? 0;
  const v30 = verifications30d ?? 0;
  const listingPosts = listings30d ?? 0;
  const businessPosts = businesses30d ?? 0;
  const promotionPosts = promotions30d ?? 0;
  const content30d = listingPosts + businessPosts + promotionPosts;
  const weeklyRunRate = s7 * 4;
  const signupMomentum =
    s30 > 0
      ? Math.round(((weeklyRunRate - s30) / Math.max(1, s30)) * 100)
      : weeklyRunRate > 0
        ? 100
        : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trends"
        description="Sign-ups, verification and new posts over the last 30 days."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Trends" }]}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sign-ups, 30 days</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{s30}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sign-ups, 7 days</CardTitle>
            <Calendar className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{s7}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Verification steps, 30 days</CardTitle>
            <BarChart3 className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{v30}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Posts created, 30 days</CardTitle>
            <Activity className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{content30d}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ColumnChartPanel
          title="Sign-up pace"
          description="Sign-ups in the last 30 days, next to the pace of the last 7 days scaled up to 30 days (7-day sign-ups × 4)."
          data={[
            { label: "Last 30 days", value: s30, tone: "sky" },
            {
              label: "Current pace",
              value: weeklyRunRate,
              tone: signupMomentum >= 0 ? "emerald" : "amber",
            },
          ]}
        />
        <HorizontalBarPanel
          title="New posts by type"
          description="Listings, business profiles and Tourism & Events posts created in the last 30 days."
          data={[
            { label: "Listings", value: listingPosts, tone: "emerald" },
            { label: "Business profiles", value: businessPosts, tone: "sky" },
            { label: "Tourism & Events", value: promotionPosts, tone: "violet" },
          ]}
        />
      </div>

      <DecisionPanel
        title="What this means"
        description="Whether sign-ups are speeding up, and whether new posts keep up with new members."
        items={[
          {
            label: "Sign-up momentum",
            value: `${signupMomentum >= 0 ? "+" : ""}${signupMomentum}%`,
            detail:
              signupMomentum >= 0
                ? "The last week is ahead of the 30-day pace. Make sure verification can keep up before spending more on marketing."
                : "The last week is behind the 30-day pace. Check where new members come from and where they drop off during sign-up.",
            tone: signupMomentum >= 0 ? "emerald" : "amber",
          },
          {
            label: "New posts",
            value: `${content30d}`,
            detail:
              content30d >= s30
                ? "At least one new post per new member, so buyers keep finding fresh content."
                : "Fewer new posts than new members. Encourage new members to post their first listing, business or event.",
            tone: content30d >= s30 ? "emerald" : "amber",
          },
        ]}
      />
    </div>
  );
}
