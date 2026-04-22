"use client";

import { formatRelativeTime } from "@/lib/utils/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Package } from "lucide-react";
import { ContentDecisionDialog } from "@/components/admin/content-decision-dialog";
import { useContentDecision } from "@/components/admin/use-content-decision";

interface ContentItem {
  id: string;
  title?: string;
  name?: string;
  business_name?: string;
  store_number?: string;
  mall_name?: string;
  status: string;
  created_at: string;
  category?: string;
  owner_id?: string;
}

interface ContentQueueTableProps {
  items: ContentItem[];
  area: string;
  onDecisionComplete?: () => void;
}

export function ContentQueueTable({ items, area, onDecisionComplete }: ContentQueueTableProps) {
  const {
    selectedItem,
    decision,
    rejectReason,
    loading,
    error,
    setRejectReason,
    openReview,
    closeDialog,
    submitDecision,
  } = useContentDecision<ContentItem>({
    getArea: () => area,
    onDecisionComplete,
    rejectReasonRequiredMessage: "Please provide a reason for rejection.",
  });

  if (!items.length) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Package className="h-8 w-8 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No content pending moderation.</p>
      </div>
    );
  }

  function getItemName(item: ContentItem): string {
    return (
      item.title ||
      item.business_name ||
      item.name ||
      item.mall_name ||
      `Item ${item.id.slice(0, 8)}`
    );
  }

  return (
    <>
      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.id}>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{getItemName(item)}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {item.status}
                    </Badge>
                    {item.category && (
                      <Badge variant="secondary" className="text-[10px]">
                        {item.category}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Submitted {formatRelativeTime(item.created_at)}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0 flex-wrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                    onClick={() => openReview(item, "approve")}
                    disabled={loading}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    <span className="text-xs">Approve</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-destructive hover:bg-destructive/10"
                    onClick={() => openReview(item, "reject")}
                    disabled={loading}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    <span className="text-xs">Reject</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ContentDecisionDialog
        open={!!selectedItem}
        decision={decision}
        rejectReason={rejectReason}
        error={error}
        loading={loading}
        onOpenChange={(open) => !open && closeDialog()}
        onRejectReasonChange={setRejectReason}
        onConfirm={submitDecision}
        title={decision === "approve" ? "Approve Content" : "Reject Content"}
        description={
          selectedItem
            ? decision === "approve"
              ? "This will publish the content and make it visible to the public."
              : "This will reject the content. The account holder will be notified."
            : ""
        }
        confirmLabel={decision === "approve" ? "Confirm Approve" : "Confirm Reject"}
      />
    </>
  );
}
