import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, AlertTriangle, CheckCircle } from "lucide-react";

export const metadata = {
  title: "Oversight Hub — Governance",
  description: "Oversight analytics for governance controllers.",
};

export default async function GovernanceOversightPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "oversight:view")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  // Gather oversight metrics
  const [
    { count: totalDecisions },
    { count: approvedDecisions },
    { count: rejectedDecisions },
    { count: overriddenDecisions },
  ] = await Promise.all([
    admin.from("decision_records").select("*", { count: "exact", head: true }),
    admin
      .from("decision_records")
      .select("*", { count: "exact", head: true })
      .eq("status", "approved"),
    admin
      .from("decision_records")
      .select("*", { count: "exact", head: true })
      .eq("status", "rejected"),
    admin
      .from("decision_records")
      .select("*", { count: "exact", head: true })
      .eq("status", "overridden"),
  ]);

  const total = totalDecisions ?? 0;
  const approved = approvedDecisions ?? 0;
  const rejected = rejectedDecisions ?? 0;
  const overridden = overriddenDecisions ?? 0;
  const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;
  const overrideRate = total > 0 ? Math.round((overridden / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Oversight Hub"
        description="Governance quality metrics and decision analytics."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Oversight Hub" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Decisions</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approval Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{approvalRate}%</div>
            <p className="text-xs text-muted-foreground">
              {approved} approved / {rejected} rejected
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Override Rate</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overrideRate}%</div>
            <p className="text-xs text-muted-foreground">{overridden} overridden</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Decision Volume</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
            <p className="text-xs text-muted-foreground">all time</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
