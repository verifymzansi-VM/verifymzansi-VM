import { formatRelativeTime } from "@/lib/utils/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollText } from "lucide-react";

interface AuditEntry {
  id: string;
  actor_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface ActivityFeedProps {
  entries: AuditEntry[];
  emptyMessage?: string;
}

/** Human-readable labels for audit actions */
const ACTION_LABELS: Record<string, string> = {
  verification_approved: "Approved verification",
  verification_rejected: "Rejected verification",
  verification_submitted: "Verification submitted",
  listing_created: "Listing created",
  listing_updated: "Listing updated",
  listing_deleted: "Listing deleted",
  report_created: "Report filed",
  report_resolved: "Report resolved",
  account_suspended: "Account suspended",
  account_banned: "Account banned",
  account_unbanned: "Account unbanned",
  moderation_action: "Moderation action",
  dsar_requested: "DSAR requested",
  dsar_completed: "DSAR completed",
  consent_updated: "Consent updated",
  payment_completed: "Payment completed",
  content_approve: "Content approved",
  content_reject: "Content rejected",
  kyc_approve: "KYC approved",
  kyc_reject: "KYC rejected",
  kyc_resubmission: "KYC needs resubmission",
  flag_warn: "Warning issued",
  flag_hide: "Content hidden",
  flag_suspend: "Account suspended",
  flag_ban: "Account banned",
  flag_dismiss: "Report dismissed",
};

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/_/g, " ");
}

export function ActivityFeed({ entries, emptyMessage }: ActivityFeedProps) {
  if (!entries.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">{emptyMessage || "No recent activity."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors"
        >
          <div className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{getActionLabel(entry.action)}</span>
              {entry.target_type && (
                <Badge variant="outline" className="text-[10px]">
                  {entry.target_type}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {entry.actor_id.slice(0, 8)}... &middot; {formatRelativeTime(entry.created_at)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Card wrapper version of ActivityFeed for use in dashboards */
export function ActivityFeedCard({
  entries,
  title = "Recent Activity",
}: {
  entries: AuditEntry[];
  title?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-sm font-semibold mb-4">{title}</h3>
        <ActivityFeed entries={entries} />
      </CardContent>
    </Card>
  );
}
