"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/utils/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CheckCircle, XCircle, Package, Eye, Search, MapPin, User } from "lucide-react";
import { ContentDecisionDialog } from "@/components/admin/content-decision-dialog";
import { useContentDecision } from "@/components/admin/use-content-decision";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

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
  area?: string;
  areaLabel?: string;
  itemType?: string;
  contentType?: "listing" | "business" | "promotion";
  description?: string | null;
  location_province?: string | null;
  location_city?: string | null;
  price_cents?: number | null;
  photos?: string[] | null;
  videos?: string[] | null;
  logo_url?: string | null;
  cover_photo?: string | null;
  gallery_photos?: string[] | null;
}

interface ContentQueueTableProps {
  items: ContentItem[];
  area: string;
  onDecisionComplete?: () => void;
}

export function ContentQueueTable({ items, area, onDecisionComplete }: ContentQueueTableProps) {
  const [query, setQuery] = useState("");
  const [previewItem, setPreviewItem] = useState<ContentItem | null>(null);
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
    getArea: (item) => item.area || area,
    getContentType: (item) => item.contentType,
    onDecisionComplete: () => {
      setPreviewItem(null);
      onDecisionComplete?.();
    },
    rejectReasonRequiredMessage: "Please provide a reason for rejection.",
  });

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((item) => {
        const haystack = [
          getItemName(item),
          item.itemType,
          item.category,
          item.location_province,
          item.location_city,
          item.owner_id,
          item.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      })
    : items;

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

  function getMediaCount(item: ContentItem) {
    return (
      (item.photos?.length ?? 0) +
      (item.videos?.length ?? 0) +
      (item.gallery_photos?.length ?? 0) +
      (item.logo_url ? 1 : 0) +
      (item.cover_photo ? 1 : 0)
    );
  }

  function getContentTypeLabel(item: ContentItem) {
    return item.itemType || item.contentType || "Content";
  }

  function getMediaUrls(item: ContentItem) {
    return [...(item.photos ?? []), ...(item.gallery_photos ?? []), item.cover_photo, item.logo_url]
      .filter((url): url is string => Boolean(url))
      .map(normalizeMediaUrl)
      .slice(0, 6);
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, category, location, owner..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{items.length} pending</Badge>
          <Badge variant="outline">{filteredItems.length} shown</Badge>
        </div>
      </div>

      <div className="space-y-3">
        {filteredItems.map((item) => (
          <Card key={item.id}>
            <CardContent className="py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{getItemName(item)}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {getContentTypeLabel(item)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {item.status}
                    </Badge>
                    {item.category && (
                      <Badge variant="secondary" className="text-[10px]">
                        {item.category}
                      </Badge>
                    )}
                    {getMediaCount(item) > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        {getMediaCount(item)} media
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Submitted {formatRelativeTime(item.created_at)}</span>
                    {item.location_city && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {[item.location_city, item.location_province].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {item.owner_id && (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" />
                        Owner {item.owner_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => setPreviewItem(item)}
                    disabled={loading}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    <span className="text-xs">Review</span>
                  </Button>
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

      {filteredItems.length === 0 && (
        <p className="text-center py-6 text-sm text-muted-foreground">
          No pending content matches that search.
        </p>
      )}

      <Sheet open={!!previewItem} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{previewItem ? getItemName(previewItem) : "Review content"}</SheetTitle>
            <SheetDescription>
              Check the submission details before publishing or rejecting it.
            </SheetDescription>
          </SheetHeader>

          {previewItem && (
            <div className="mt-6 space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{getContentTypeLabel(previewItem)}</Badge>
                <Badge variant="secondary">{previewItem.areaLabel || area}</Badge>
                {previewItem.category && <Badge variant="secondary">{previewItem.category}</Badge>}
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">Submitted</p>
                <p>{formatRelativeTime(previewItem.created_at)}</p>
              </div>

              {previewItem.description && (
                <div className="rounded-md border p-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Description</p>
                  <p className="mt-1 whitespace-pre-wrap">{previewItem.description}</p>
                </div>
              )}

              {getMediaUrls(previewItem).length > 0 && (
                <div className="rounded-md border p-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Media</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {getMediaUrls(previewItem).map((url, index) => (
                      <div
                        key={`${url}-${index}`}
                        className="aspect-square overflow-hidden rounded-md bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`${getItemName(previewItem)} media ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Location</p>
                  <p>
                    {[previewItem.location_city, previewItem.location_province]
                      .filter(Boolean)
                      .join(", ") || "Not provided"}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Media</p>
                  <p>{getMediaCount(previewItem)} attached</p>
                </div>
              </div>
            </div>
          )}

          <SheetFooter className="mt-6 flex-row gap-2 sm:justify-between">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (previewItem) openReview(previewItem, "reject");
              }}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              className="bg-brand-green text-white hover:bg-brand-green/90"
              onClick={() => {
                if (previewItem) openReview(previewItem, "approve");
              }}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
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
              ? "This will publish the content and make it visible to the public."
              : "This will reject the content. The account holder will be notified."
            : ""
        }
        confirmLabel={decision === "approve" ? "Confirm Approve" : "Confirm Reject"}
      />
    </>
  );
}
