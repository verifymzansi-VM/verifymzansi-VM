import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, AlertTriangle, Clock } from "lucide-react";

export const metadata = {
  title: "Enforcement Review — Governance",
  description: "Review pending and recent enforcement actions.",
};

export default async function GovernanceEnforcementPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "enforcement:execute")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  const [
    { data: recentActions, count: totalActions },
    { count: activeSuspensions },
    { count: activeBans },
  ] = await Promise.all([
    admin
      .from("moderation_actions")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("account_profiles")
      .select("*", { count: "exact", head: true })
      .eq("account_status", "suspended"),
    admin
      .from("account_profiles")
      .select("*", { count: "exact", head: true })
      .eq("account_status", "banned"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enforcement Review"
        description="Monitor enforcement actions and account status changes."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Enforcement Review" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Actions</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalActions ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Suspensions</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSuspensions ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Bans</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeBans ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Enforcement Actions</CardTitle>
        </CardHeader>
        <CardContent>
          {!recentActions || recentActions.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No recent enforcement actions.
            </p>
          ) : (
            <div className="space-y-2">
              {recentActions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="text-sm font-medium capitalize">{action.action}</p>
                    <p className="text-xs text-muted-foreground">
                      Target: {action.target_owner_id?.slice(0, 8)}... ·{" "}
                      {new Date(action.created_at).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-1">{action.reason}</p>
                  </div>
                  <Badge variant={action.action === "ban" ? "destructive" : "secondary"}>
                    {action.action}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
