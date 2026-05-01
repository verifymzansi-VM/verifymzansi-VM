import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
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
  title: "Trend Analysis — Intelligence",
  description: "Platform activity trends over time.",
};

export default async function IntelligenceTrendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "bi:view")) {
    redirect("/admin");
  }

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
        title="Trend Analysis"
        description="Activity trends and growth indicators."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Trend Analysis" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Signups (30d)</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{s30}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Signups (7d)</CardTitle>
            <Calendar className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{s7}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Verifications (30d)</CardTitle>
            <BarChart3 className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{v30}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Content Posted (30d)</CardTitle>
            <Activity className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{content30d}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ColumnChartPanel
          title="Growth run-rate"
          description="Compares the latest 7-day signup pace with the last 30 days."
          data={[
            { label: "30d signups", value: s30, tone: "sky" },
            {
              label: "7d x4 run-rate",
              value: weeklyRunRate,
              tone: signupMomentum >= 0 ? "emerald" : "amber",
            },
            { label: "30d verifications", value: v30, tone: "violet" },
            { label: "30d content", value: content30d, tone: "amber" },
          ]}
        />
        <HorizontalBarPanel
          title="Content creation mix"
          description="Breaks recent supply creation into listing, business, and promotion activity."
          data={[
            { label: "Listings", value: listingPosts, tone: "emerald" },
            { label: "Businesses", value: businessPosts, tone: "sky" },
            { label: "Promotions", value: promotionPosts, tone: "violet" },
          ]}
        />
      </div>

      <DecisionPanel
        title="Decision notes"
        description="Signals for growth pacing and whether supply creation is keeping up."
        items={[
          {
            label: "Signup momentum",
            value: `${signupMomentum >= 0 ? "+" : ""}${signupMomentum}%`,
            detail:
              signupMomentum >= 0
                ? "The latest week is pacing ahead of the 30-day baseline. Check onboarding capacity before increasing acquisition."
                : "The latest week is below the 30-day baseline. Review acquisition channels and activation friction.",
            tone: signupMomentum >= 0 ? "emerald" : "amber",
          },
          {
            label: "Supply creation",
            value: `${content30d}`,
            detail:
              content30d >= s30
                ? "Content creation is keeping pace with signups, which supports marketplace liquidity."
                : "Content creation trails signups. Nudge new users toward first listing, business, or promotion creation.",
            tone: content30d >= s30 ? "emerald" : "amber",
          },
        ]}
      />
    </div>
  );
}
