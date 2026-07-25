import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, FileText, User } from "lucide-react";
import { DecisionActionButtons } from "./decision-action-buttons";

export const metadata = {
  title: "Decision Detail — Governance",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DecisionDetailPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "decision:approve")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  const { data: decision, error } = await admin
    .from("decision_records")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !decision) {
    notFound();
  }

  const { data: timelineEvents } = await admin
    .from("decision_record_events")
    .select("*")
    .eq("decision_id", id)
    .order("created_at", { ascending: true });

  const statusColor = (s: string) => {
    switch (s) {
      case "approved":
        return "default" as const;
      case "rejected":
        return "destructive" as const;
      case "pending_approval":
        return "secondary" as const;
      case "escalated":
        return "outline" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Decision: ${decision.action_category}`}
        description={`Record ${decision.id.slice(0, 8)}…`}
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Escalations", href: "/admin/governance/escalations" },
          { label: "Detail" },
        ]}
      />

      {/* Decision Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Decision Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge variant={statusColor(decision.status)}>{decision.status}</Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Category</p>
              <p className="font-medium">{decision.action_category}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Case</p>
              <p className="font-mono text-sm">
                {decision.case_type}:{decision.case_id}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Recommender</p>
              <p className="font-mono text-sm">{decision.recommender_id?.slice(0, 12) ?? "N/A"}…</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Correlation</p>
              <p className="font-mono text-sm">{decision.correlation_id?.slice(0, 12) ?? "N/A"}…</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="text-sm">{new Date(decision.created_at).toLocaleString()}</p>
            </div>
          </div>

          {/* Recommendation */}
          <div className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <User className="h-4 w-4" />
              <p className="font-medium text-sm">Recommendation</p>
            </div>
            <p className="text-sm">{decision.recommendation || "No recommendation provided."}</p>
            <p className="text-xs text-muted-foreground mt-1">
              By {decision.recommender_id?.slice(0, 8)}… on{" "}
              {decision.created_at ? new Date(decision.created_at).toLocaleString() : "—"}
            </p>
          </div>

          {/* Approval (if present) */}
          {decision.approved_by && (
            <div className="rounded-lg border p-4 bg-green-50 dark:bg-green-950/20">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-4 w-4" />
                <p className="font-medium text-sm">Approval</p>
              </div>
              <p className="text-sm">{decision.approval_rationale || "No reason provided."}</p>
              <p className="text-xs text-muted-foreground mt-1">
                By {decision.approved_by?.slice(0, 8)}… on{" "}
                {decision.decided_at ? new Date(decision.decided_at).toLocaleString() : "—"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions — only while the decision is still open */}
      {(decision.status === "pending_approval" || decision.status === "escalated") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Decide
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DecisionActionButtons
              decisionId={decision.id}
              actionCategory={decision.action_category}
            />
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Decision Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!timelineEvents?.length ? (
            <p className="text-sm text-muted-foreground">No timeline events recorded.</p>
          ) : (
            <div className="space-y-3">
              {timelineEvents.map((event: Record<string, unknown>) => (
                <div
                  key={event.id as string}
                  className="flex items-start gap-3 border-l-2 pl-4 py-2"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium">{event.event_type as string}</p>
                    <p className="text-xs text-muted-foreground">
                      {typeof event.detail === "object" && event.detail !== null
                        ? JSON.stringify(event.detail)
                        : String(event.detail ?? "")}
                    </p>
                  </div>
                  <time className="text-xs text-muted-foreground flex-shrink-0">
                    {new Date(event.created_at as string).toLocaleString()}
                  </time>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
