import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionPanel, HorizontalBarPanel } from "@/components/admin/intelligence-panels";
import { Users, UserPlus, TrendingUp, CheckCircle } from "lucide-react";

export const metadata = {
  title: "Users & Growth — Intelligence",
  description: "User acquisition, retention, and growth analytics.",
};

export default async function IntelligenceUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "bi:view")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  const [
    { count: totalUsers },
    { count: verifiedUsers },
    { count: suspendedUsers },
    { count: bannedUsers },
  ] = await Promise.all([
    admin.from(ACCOUNT_PROFILE_WRITE_TABLE).select("*", { count: "exact", head: true }),
    admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("account_verification_status", "verified"),
    admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("account_status", "suspended"),
    admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("account_status", "banned"),
  ]);

  const total = totalUsers ?? 0;
  const verified = verifiedUsers ?? 0;
  const suspended = suspendedUsers ?? 0;
  const banned = bannedUsers ?? 0;
  const active = Math.max(0, total - suspended - banned);
  const unverified = Math.max(0, total - verified);
  const verificationRate = total > 0 ? Math.round((verified / total) * 100) : 0;
  const riskRate = total > 0 ? Math.round(((suspended + banned) / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & Growth"
        description="User base analytics and growth tracking."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Users & Growth" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Verified Users</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{verified}</div>
            <p className="text-xs text-muted-foreground">{verificationRate}% of total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suspended Accounts</CardTitle>
            <UserPlus className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{suspended}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Banned Accounts</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{banned}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <HorizontalBarPanel
          title="Verification adoption"
          description="Shows how much of the user base can be trusted for higher-risk marketplace actions."
          data={[
            {
              label: "Verified users",
              value: verified,
              caption: `${verificationRate}% of total users`,
              tone: "emerald",
            },
            {
              label: "Unverified users",
              value: unverified,
              caption: `${Math.max(0, 100 - verificationRate)}% still need verification`,
              tone: "amber",
            },
          ]}
        />
        <HorizontalBarPanel
          title="Account health mix"
          description="Separates usable accounts from accounts requiring trust and safety attention."
          data={[
            { label: "Active or reviewable accounts", value: active, tone: "sky" },
            { label: "Suspended accounts", value: suspended, tone: "amber" },
            { label: "Banned accounts", value: banned, tone: "rose" },
          ]}
        />
      </div>

      <DecisionPanel
        title="Decision notes"
        description="Signals for growth, trust, and operational planning."
        items={[
          {
            label: "Activation opportunity",
            value: `${unverified}`,
            detail:
              "Unverified accounts are the clearest growth pool. Use reminders or verification incentives before adding acquisition spend.",
            tone: unverified > 0 ? "amber" : "emerald",
          },
          {
            label: "Trust exposure",
            value: `${riskRate}%`,
            detail:
              riskRate > 5
                ? "Suspended and banned accounts are elevated. Review abuse patterns and tighten risky flows."
                : "Account enforcement volume is low relative to the user base.",
            tone: riskRate > 5 ? "rose" : "emerald",
          },
        ]}
      />
    </div>
  );
}
