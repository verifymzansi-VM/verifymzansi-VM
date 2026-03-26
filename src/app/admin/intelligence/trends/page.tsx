import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const content30d = (listings30d ?? 0) + (businesses30d ?? 0) + (promotions30d ?? 0);

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
    </div>
  );
}
