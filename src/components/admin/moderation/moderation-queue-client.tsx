"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelativeTime } from "@/lib/utils/format";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { CheckCircle, XCircle, Package, Eye, FolderX, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ModerationPreviewPanel, type ModerationItem } from "./moderation-preview-panel";
import { ContentDecisionDialog } from "@/components/admin/content-decision-dialog";
import { useContentDecision } from "@/components/admin/use-content-decision";
import { ClaimBadge, ClaimGate } from "@/components/admin/queue-claims";
import { claimTypeOf } from "@/lib/admin/moderation-items";

interface ModerationQueueClientProps {
  items: ModerationItem[];
}

function formatCategoryLabel(category?: string) {
  if (!category) return "Uncategorised";
  return category.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function buildWrongCategoryReason(item: ModerationItem) {
  const categoryLabel = formatCategoryLabel(item.category);
  return (
    `Blocked: this post is categorised as "${categoryLabel}" but does not belong in ` +
    `${item.areaLabel}. Please resubmit it under the correct category.`
  );
}

export function ModerationQueueClient({ items }: ModerationQueueClientProps) {
  const router = useRouter();
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [previewItem, setPreviewItem] = useState<ModerationItem | null>(null);
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
  } = useContentDecision<ModerationItem>({
    getArea: (item) => item.area,
    getContentType: (item) => item.contentType,
    getExpectedUpdatedAt: (item) => item.updated_at,
    getEndpoint: (item) =>
      item.isEditRequest ? "/api/admin/content-edits/decide" : "/api/admin/content/decide",
    onDecisionComplete: () => {
      closePreview();
      router.refresh();
    },
    rejectReasonRequiredMessage: "Please provide a rejection reason.",
  });

  const areas = ["all", ...Array.from(new Set(items.map((i) => i.area)))];
  const needle = query.trim().toLowerCase();
  const filtered = items.filter(
    (i) =>
      (areaFilter === "all" || i.area === areaFilter) &&
      (!needle ||
        [i.title, i.itemType, i.category, i.location_city, i.location_province, i.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle))
  );

  function openPreview(item: ModerationItem) {
    setPreviewItem(item);
  }

  function closePreview() {
    setPreviewItem(null);
  }

  function openWrongCategory(item: ModerationItem) {
    openReview(item, "reject", buildWrongCategoryReason(item));
  }

  if (!items.length) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Package className="h-8 w-8 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No content pending moderation.</p>
      </div>
    );
  }

  function getThumbnailUrl(item: ModerationItem) {
    if (item.photos?.[0]) return normalizeMediaUrl(item.photos[0]);
    if (item.cover_photo) return normalizeMediaUrl(item.cover_photo);
    if (item.gallery_photos?.[0]) return normalizeMediaUrl(item.gallery_photos[0]);
    if (item.logo_url) return normalizeMediaUrl(item.logo_url);
    return null;
  }

  return (
    <>
      {/* Area filter, when the queue spans more than one area */}
      {areas.length > 2 && (
        <div className="flex flex-wrap gap-2 mb-4">
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
      )}

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search this queue"
          placeholder="Search by title, type, category or place"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing in this queue matches that search.
        </p>
      )}

      <div className="min-w-0 w-full max-w-full space-y-3">
        {filtered.map((item) => (
          <Card
            key={item.id}
            className="w-full cursor-pointer transition-colors hover:border-brand-green/40"
            onClick={() => openPreview(item)}
          >
            <CardContent className="py-4">
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 sm:gap-4">
                {/* Thumbnail preview */}
                {getThumbnailUrl(item) ? (
                  <div className="relative h-14 w-14 flex-shrink-0 rounded-md overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getThumbnailUrl(item)!}
                      alt={`${item.title} thumbnail`}
                      className="h-full w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="h-14 w-14 flex-shrink-0 rounded-md bg-muted flex items-center justify-center">
                    <Package className="h-5 w-5 text-muted-foreground/50" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {item.title || `Item ${item.id.slice(0, 8)}`}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {item.itemType}
                    </Badge>
                    {item.isEditRequest && (
                      <Badge variant="outline" className="text-[10px]">
                        Edit review
                      </Badge>
                    )}
                    {item.isEditRequest &&
                      item.change_summary &&
                      item.change_summary.length > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {item.change_summary.length} changed
                        </Badge>
                      )}
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
                  {item.isEditRequest && item.change_summary && item.change_summary.length > 0 && (
                    <p className="mt-1 line-clamp-1 text-xs text-amber-700">
                      Updates: {item.change_summary.map((change) => change.label).join(", ")}
                    </p>
                  )}
                </div>
                <ClaimGate type={claimTypeOf(item)} id={item.id}>
                  {(claim) => (
                    <div className="col-span-2 min-w-0 w-full max-w-full space-y-1">
                      <div className="col-span-2 min-w-0 w-full max-w-full flex flex-wrap justify-start gap-1 border-t border-border/60 pt-3 lg:justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 min-w-0 text-xs gap-1"
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
                          className="h-8 min-w-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950"
                          disabled={claim.blocked}
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
                          className="h-8 min-w-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
                          disabled={claim.blocked}
                          onClick={(e) => {
                            e.stopPropagation();
                            openWrongCategory(item);
                          }}
                        >
                          <FolderX className="h-4 w-4 mr-1" />
                          <span className="text-xs">Wrong category</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 min-w-0 text-destructive hover:bg-destructive/10"
                          disabled={claim.blocked}
                          onClick={(e) => {
                            e.stopPropagation();
                            openReview(item, "reject");
                          }}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          <span className="text-xs">Reject</span>
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <ClaimBadge type={claimTypeOf(item)} id={item.id} />
                        {claim.blockedReason && (
                          <p className="text-[11px] text-muted-foreground">{claim.blockedReason}</p>
                        )}
                      </div>
                    </div>
                  )}
                </ClaimGate>
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

          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-4 sm:px-6">
            {previewItem && <ModerationPreviewPanel item={previewItem} />}
          </div>

          <SheetFooter className="border-t px-6 py-4 flex-row flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
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
                variant="outline"
                className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
                onClick={() => {
                  if (previewItem) openWrongCategory(previewItem);
                }}
              >
                <FolderX className="h-4 w-4" />
                Wrong category
              </Button>
            </div>
            <Button
              size="sm"
              className="gap-1.5 bg-brand-green hover:bg-brand-green/90 text-white"
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
              ? `This will publish "${selectedItem.title || "this item"}" and make it live.`
              : `This will reject "${selectedItem.title || "this item"}". The account holder will be notified.`
            : ""
        }
        confirmLabel={decision === "approve" ? "Publish" : "Reject"}
      />
    </>
  );
}
