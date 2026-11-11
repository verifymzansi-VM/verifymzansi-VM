import { requireStaff } from "@/lib/auth/require-staff";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, MessageSquare } from "lucide-react";
import { AppealResolveForm } from "./appeal-resolve-form";
import { formatDateTime } from "@/lib/utils/format";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFrontendAppeals } from "@/lib/foundation/member-appeals";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { z } from "zod";

export const metadata = {
  title: "Appeal — Governance",
};

interface Props {
  params: Promise<{ id: string }>;
}

async function readNativeAppeal(id: string, userId: string) {
  const { api } = await readFoundationServerSession();
  let item;
  try {
    const result = await readFrontendAppeals(api, userId, id);
    item = result.items[0];
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step", `/admin/governance/appeals/${id}`));
    throw error;
  }
  if (!item) notFound();
  const categories = {
    ban: "account_ban",
    suspension: "account_suspend",
    warning: "account_warning",
    content_hidden: "content_removal",
  } as const;
  return {
    // Status as text: the screen also handles the older "under_review" status.
    appeal: item as Omit<typeof item, "status"> & { status: string },
    decision: item.decision_reason
      ? {
          action_category: categories[item.kind],
          status: item.status === "overturned" ? "overridden" : "approved",
          case_type: "decision",
          case_id: item.decision_id,
          recommendation: item.decision_reason,
        }
      : null,
    canResolve: item.can_resolve,
    effectVersion: item.effect_version ?? undefined,
    canShorten:
      item.kind === "suspension" && Boolean(item.ends_at && Date.parse(item.ends_at) > Date.now()),
  };
}

export default async function AppealDetailPage({ params }: Props) {
  const { id } = await params;
  const { user } = await requireStaff("appeal:decide");
  if (!z.uuid().safeParse(id).success) notFound();
  const { appeal, decision, canResolve, effectVersion, canShorten } = await readNativeAppeal(
    id,
    user.id
  );

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
        title="Appeal"
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
            Appeal details
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
              <p className="text-sm">{formatDateTime(appeal.created_at)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Appellant</p>
              <p className="font-mono text-sm">{appeal.appellant_id?.slice(0, 12)}…</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Linked decision</p>
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
                {appeal.resolved_at ? formatDateTime(appeal.resolved_at) : "—"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resolution form — only while the appeal is unresolved */}
      {(appeal.status === "submitted" || appeal.status === "under_review") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Resolve appeal
            </CardTitle>
          </CardHeader>
          <CardContent>
            {canResolve ? (
              <AppealResolveForm
                appealId={appeal.id}
                effectVersion={effectVersion}
                canShorten={canShorten}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                This appeal requires another reviewer or its decision is unavailable.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Linked Decision */}
      {decision && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Linked decision
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
