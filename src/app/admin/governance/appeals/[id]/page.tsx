import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, MessageSquare } from "lucide-react";

export const metadata = {
  title: "Appeal Detail — Governance",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AppealDetailPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !hasCapability(user, "appeal:decide")) {
    redirect("/admin");
  }

  const admin = createAdminClient();

  const { data: appeal, error } = await admin
    .from("appeal_cases")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !appeal) {
    notFound();
  }

  // Get linked decision record
  const { data: decision } = await admin
    .from("decision_records")
    .select("*")
    .eq("id", appeal.decision_id)
    .single();

  const statusColor = (s: string) => {
    switch (s) {
      case "upheld":
        return "default" as const;
      case "overturned":
        return "destructive" as const;
      case "under_review":
        return "secondary" as const;
      case "submitted":
        return "outline" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appeal Detail"
        description={`Appeal ${appeal.id.slice(0, 8)}…`}
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Appeals", href: "/admin/governance/appeals" },
          { label: "Detail" },
        ]}
      />

      {/* Appeal Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Appeal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge variant={statusColor(appeal.status)}>{appeal.status}</Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Submitted</p>
              <p className="text-sm">{new Date(appeal.created_at).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Appellant</p>
              <p className="font-mono text-sm">{appeal.appellant_id?.slice(0, 12)}…</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Linked Decision</p>
              <p className="font-mono text-sm">{appeal.decision_id?.slice(0, 12)}…</p>
            </div>
          </div>

          <div className="rounded-lg border p-4 bg-muted/30">
            <p className="font-medium text-sm mb-1">Appeal Reason</p>
            <p className="text-sm">{appeal.reason || "No reason provided."}</p>
          </div>

          {appeal.reviewer_rationale && (
            <div className="rounded-lg border p-4 bg-blue-50 dark:bg-blue-950/20">
              <p className="font-medium text-sm mb-1">Resolution</p>
              <p className="text-sm">{appeal.reviewer_rationale}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Resolved by {appeal.reviewer_id?.slice(0, 8)}… on{" "}
                {appeal.resolved_at ? new Date(appeal.resolved_at).toLocaleString() : "—"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Decision */}
      {decision && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Linked Decision
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Category</p>
                <p className="font-medium">{decision.action_category}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge variant="outline">{decision.status}</Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Case</p>
                <p className="font-mono text-sm">
                  {decision.case_type}:{decision.case_id}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Recommendation</p>
                <p className="text-sm">{decision.recommendation || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
