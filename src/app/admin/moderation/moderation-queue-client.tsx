"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelativeTime } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle, XCircle, Package, Loader2, Eye } from "lucide-react";
import { ModerationPreviewPanel, type ModerationItem } from "./moderation-preview-panel";

interface ModerationQueueClientProps {
  items: ModerationItem[];
}

export function ModerationQueueClient({ items }: ModerationQueueClientProps) {
  const router = useRouter();
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [previewItem, setPreviewItem] = useState<ModerationItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<ModerationItem | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const areas = ["all", ...Array.from(new Set(items.map((i) => i.area)))];
  const filtered = areaFilter === "all" ? items : items.filter((i) => i.area === areaFilter);

  function openPreview(item: ModerationItem) {
    setPreviewItem(item);
  }

  function closePreview() {
    setPreviewItem(null);
  }

  function openReview(item: ModerationItem, d: "approve" | "reject") {
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
      setError("Please provide a rejection reason.");
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
          area: selectedItem.area,
          decision,
          reason: decision === "reject" ? rejectReason : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit decision");
      }

      closeDialog();
      closePreview();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (!items.length) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No content pending moderation.</p>
        <p className="text-xs mt-1">All submissions have been reviewed.</p>
      </div>
    );
  }

  return (
    <>
      {/* Area Filter */}
      <div className="flex gap-2 mb-4">
        {areas.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={areaFilter === a ? "default" : "outline"}
            className="text-xs"
            onClick={() => setAreaFilter(a)}
          >
            {a === "all"
              ? `All (${items.length})`
              : `${items.find((i) => i.area === a)?.areaLabel || a} (${items.filter((i) => i.area === a).length})`}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((item) => (
          <Card
            key={item.id}
            className="cursor-pointer transition-colors hover:border-brand-green/40"
            onClick={() => openPreview(item)}
          >
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                {/* Thumbnail preview */}
                {item.photos && item.photos.length > 0 ? (
                  <div className="relative h-14 w-14 flex-shrink-0 rounded-md overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={normalizeMediaUrl(item.photos[0])}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="h-14 w-14 flex-shrink-0 rounded-md bg-muted flex items-center justify-center">
                    <Package className="h-5 w-5 text-muted-foreground/50" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {item.title || `Item ${item.id.slice(0, 8)}`}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {item.itemType}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {item.areaLabel}
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
                    variant="outline"
                    className="h-8 text-xs gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPreview(item);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Review
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                    onClick={(e) => {
                      e.stopPropagation();
                      openReview(item, "approve");
                    }}
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    <span className="text-xs">Approve</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      openReview(item, "reject");
                    }}
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

      {/* ── Preview Sheet ─────────────────────────────── */}
      <Sheet open={!!previewItem} onOpenChange={(open) => !open && closePreview()}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-2">
            <SheetTitle>{previewItem?.title || `Item ${previewItem?.id.slice(0, 8)}`}</SheetTitle>
            <SheetDescription>
              Review this {previewItem?.itemType?.toLowerCase()} before making a decision.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-hidden px-6">
            {previewItem && <ModerationPreviewPanel item={previewItem} />}
          </div>

          <SheetFooter className="border-t px-6 py-4 flex-row gap-2 sm:justify-between">
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={() => {
                if (previewItem) openReview(previewItem, "reject");
              }}
            >
              <XCircle className="h-4 w-4" />
              Reject
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              onClick={() => {
                if (previewItem) openReview(previewItem, "approve");
              }}
            >
              <CheckCircle className="h-4 w-4" />
              Approve
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision === "approve" ? "Approve Content" : "Reject Content"}
            </DialogTitle>
            <DialogDescription>
              {selectedItem && (
                <>
                  {decision === "approve"
                    ? `This will publish "${selectedItem.title || "this item"}" and make it live.`
                    : `This will reject "${selectedItem.title || "this item"}". The seller will be notified.`}
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
              {decision === "approve" ? "Publish" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
