import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { getPendingDecisions } from "@/lib/services/decision-ledger";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gavel, AlertTriangle, Clock, Scale } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Escalations — Governance",
  description: "Review escalated decisions requiring governance approval.",
};

export default async function GovernanceEscalationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "decision:approve")) {
    redirect("/admin");
  }

  const pendingDecisions = await getPendingDecisions(50);

  const escalated = pendingDecisions.filter((d) => d.status === "escalated");
  const pendingApproval = pendingDecisions.filter((d) => d.status === "pending_approval");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Escalations"
        description="Decisions escalated from moderators requiring governance approval."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Escalations" }]}
      >
        <Badge variant="outline">{pendingDecisions.length} pending</Badge>
      </PageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Approval</CardTitle>
            <Gavel className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingApproval.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Escalated</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{escalated.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Queue</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingDecisions.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Decision queue */}
      <Card>
        <CardHeader>
          <CardTitle>Decision Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingDecisions.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No decisions awaiting approval.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingDecisions.map((decision) => (
                <Link
                  key={decision.id}
                  href={`/admin/governance/escalations/${decision.id}`}
                  className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {decision.status === "escalated" ? (
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                    ) : (
                      <Scale className="h-4 w-4 text-blue-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {decision.action_category.replace(/_/g, " ")} — {decision.case_type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Case: {decision.case_id} ·{" "}
                        {new Date(decision.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Badge variant={decision.status === "escalated" ? "destructive" : "secondary"}>
                    {decision.status.replace(/_/g, " ")}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
