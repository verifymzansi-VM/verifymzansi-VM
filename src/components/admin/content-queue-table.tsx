"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/utils/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle, XCircle, Package, Loader2 } from "lucide-react";

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
  seller_id?: string;
}

interface ContentQueueTableProps {
  items: ContentItem[];
  area: string;
  onDecisionComplete?: () => void;
}

export function ContentQueueTable({ items, area, onDecisionComplete }: ContentQueueTableProps) {
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!items.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
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

  function openReview(item: ContentItem, d: "approve" | "reject") {
    setSelectedItem(item);
    setDecision(d);
    setRejectReason("");
    setError("");
  }

  function closeDialog() {
    setSelectedItem(null);
    setDecision(null);
    setRejectReason("");
    setError("");
  }

  async function submitDecision() {
    if (!selectedItem || !decision) return;

    if (decision === "reject" && !rejectReason.trim()) {
      setError("Please provide a reason for rejection.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/content/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItem.id,
          area,
          decision,
          reason: decision === "reject" ? rejectReason : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit decision");
      }

      closeDialog();
      onDecisionComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
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
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                    onClick={() => openReview(item, "approve")}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    <span className="text-xs">Approve</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-destructive hover:bg-destructive/10"
                    onClick={() => openReview(item, "reject")}
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

      <Dialog open={!!selectedItem} onOpenChange={(open: boolean) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approve" ? "Approve Content" : "Reject Content"}
            </DialogTitle>
            <DialogDescription>
              {selectedItem && (
                <>
                  {decision === "approve"
                    ? "This will publish the content and make it visible to the public."
                    : "This will reject the content. The seller will be notified."}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {decision === "reject" && (
            <div>
              <Label htmlFor="reject-reason" className="text-sm font-medium">
                Rejection Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this content is being rejected..."
                rows={3}
                className="mt-1.5"
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={submitDecision}
              disabled={loading}
              variant={decision === "approve" ? "default" : "destructive"}
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {decision === "approve" ? "Confirm Approve" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
