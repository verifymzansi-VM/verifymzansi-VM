"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Play, MapPin, User, ShieldCheck, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VideoWithPoster } from "@/components/ui/video-with-poster";
import { formatZAR, formatRelativeTime } from "@/lib/utils/format";
import { normalizeMediaUrl, normalizeVideoUrl } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";

export interface ModerationItem {
  id: string;
  title?: string;
  status: string;
  created_at: string;
  category?: string;
  owner_id?: string;
  area: string;
  areaLabel: string;
  itemType: string;
  // Extended fields for preview
  description?: string;
  photos?: string[];
  videos?: string[];
  video_thumbnail?: string | null;
  price_cents?: number | null;
  price_negotiable?: boolean;
  location_province?: string;
  location_city?: string;
  location_suburb?: string | null;
  attributes?: Record<string, unknown>;
  contact_methods?: string[];
  buyer_verification_required?: boolean;
  // Storefront fields
  mall_name?: string;
  store_number?: string;
  // Business profile fields
  business_name?: string;
}

interface ModerationPreviewPanelProps {
  item: ModerationItem;
}

interface ModerationMediaItem {
  url: string;
  isVideo: boolean;
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  condition: "Condition",
  make: "Make",
  model: "Model",
  year: "Year",
  mileage_km: "Mileage (km)",
  fuel_type: "Fuel Type",
  transmission: "Transmission",
  colour: "Colour",
  brand: "Brand",
  storage: "Storage",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  size_sqm: "Size (m²)",
  property_type: "Property Type",
  furnished: "Furnished",
  parking: "Parking",
};

/** Small thumbnail placeholder for videos in the thumbnail strip */
function VideoThumbnailThumb({ firstPhoto }: { firstPhoto?: string }) {
  return firstPhoto ? (
    <div className="relative w-full h-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={firstPhoto}
        alt="Video thumbnail"
        className="w-full h-full object-cover"
        loading="lazy"
        width={80}
        height={80}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
        <Play className="h-3.5 w-3.5 text-white fill-white" />
      </div>
    </div>
  ) : (
    <div className="w-full h-full bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800 flex items-center justify-center">
      <Play className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

export function ModerationPreviewPanel({ item }: ModerationPreviewPanelProps) {
  const allMedia: ModerationMediaItem[] = [
    ...((item.photos ?? []).filter(Boolean).map((url) => ({
      url: normalizeMediaUrl(url),
      isVideo: false,
    })) satisfies ModerationMediaItem[]),
    ...((item.videos ?? []).filter(Boolean).map((url) => ({
      url: normalizeVideoUrl(url),
      isVideo: true,
    })) satisfies ModerationMediaItem[]),
  ];
  const [activeIndex, setActiveIndex] = useState(0);

  // Use video_thumbnail if available, then fall back to first photo
  const firstPhotoUrl =
    (item.video_thumbnail ? normalizeMediaUrl(item.video_thumbnail) : undefined) ||
    allMedia.find((media) => !media.isVideo)?.url ||
    undefined;

  const activeMedia = allMedia[activeIndex];
  const activeUrl = activeMedia?.url || "";
  const isVideo = activeMedia?.isVideo ?? false;

  function goTo(index: number) {
    if (index >= 0 && index < allMedia.length) {
      setActiveIndex(index);
    }
  }

  const attributes = item.attributes ?? {};
  const attributeEntries = Object.entries(attributes).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );

  const locationParts = [item.location_suburb, item.location_city, item.location_province].filter(
    Boolean
  );

  return (
    <ScrollArea className="h-[calc(100vh-10rem)]">
      <div className="space-y-5 pr-4">
        {/* ── Media Gallery ─────────────────────────── */}
        {allMedia.length > 0 ? (
          <div className="space-y-2">
            <div className="relative group rounded-lg overflow-hidden bg-warm-100 dark:bg-warm-800">
              <div className="aspect-video relative">
                {isVideo ? (
                  <VideoWithPoster
                    key={activeUrl}
                    src={activeUrl}
                    posterUrl={firstPhotoUrl}
                    controls
                    playsInline
                    className="w-full h-full object-contain bg-black rounded-lg"
                    wrapperClassName="w-full h-full"
                  />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={activeUrl}
                    alt={`${item.title ?? "Item"} - image ${activeIndex + 1}`}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}

                {allMedia.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => goTo(activeIndex - 1)}
                      disabled={activeIndex === 0}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => goTo(activeIndex + 1)}
                      disabled={activeIndex === allMedia.length - 1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60"
                      aria-label="Next image"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}

                {allMedia.length > 1 && (
                  <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs font-medium px-2 py-0.5 rounded-full backdrop-blur-sm">
                    {activeIndex + 1} / {allMedia.length}
                  </div>
                )}
              </div>
            </div>

            {/* Thumbnails */}
            {allMedia.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                {allMedia.map((media, i) => {
                  return (
                    <button
                      key={`${media.url}-${i}`}
                      type="button"
                      onClick={() => setActiveIndex(i)}
                      className={cn(
                        "relative flex-shrink-0 w-14 h-14 rounded-md overflow-hidden border-2 transition-all",
                        i === activeIndex
                          ? "border-brand-green ring-1 ring-brand-green/20"
                          : "border-transparent opacity-60 hover:opacity-100"
                      )}
                    >
                      {media.isVideo ? (
                        <VideoThumbnailThumb firstPhoto={firstPhotoUrl} />
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={media.url}
                          alt={`Thumbnail ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="aspect-video rounded-lg bg-muted flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No media</p>
          </div>
        )}

        {/* ── Title & Badges ───────────────────────── */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold font-display">
            {item.title || `Item ${item.id.slice(0, 8)}`}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {item.itemType}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {item.areaLabel}
            </Badge>
            {item.category && (
              <Badge variant="secondary" className="text-[10px] capitalize">
                {item.category.replace(/_/g, " ")}
              </Badge>
            )}
            {typeof attributes.condition === "string" && (
              <Badge variant="outline" className="text-[10px] capitalize">
                {attributes.condition.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
        </div>

        {/* ── Price ────────────────────────────────── */}
        {item.price_cents != null && (
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold font-display text-brand-green">
              {formatZAR(item.price_cents)}
            </p>
            {item.price_negotiable && (
              <Badge className="bg-brand-green/10 text-brand-green text-xs">Negotiable</Badge>
            )}
          </div>
        )}

        <Separator />

        {/* ── Description ──────────────────────────── */}
        {item.description && (
          <div className="space-y-1.5">
            <h4 className="text-sm font-semibold">Description</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {item.description}
            </p>
          </div>
        )}

        {/* ── Location ─────────────────────────────── */}
        {locationParts.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <div className="rounded-full bg-brand-green/10 p-1.5">
              <MapPin className="h-3.5 w-3.5 text-brand-green" />
            </div>
            <span className="text-muted-foreground">{locationParts.join(", ")}</span>
          </div>
        )}

        {/* ── Category Attributes ──────────────────── */}
        {attributeEntries.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                Details
              </h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {attributeEntries.map(([key, value]) => (
                  <div key={key} className="text-sm">
                    <span className="text-muted-foreground">
                      {ATTRIBUTE_LABELS[key] || key.replace(/_/g, " ")}:
                    </span>{" "}
                    <span className="font-medium capitalize">
                      {typeof value === "boolean"
                        ? value
                          ? "Yes"
                          : "No"
                        : String(value).replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Contact Methods ──────────────────────── */}
        {item.contact_methods && item.contact_methods.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Contact:</span>
            {item.contact_methods.map((m) => (
              <Badge key={m} variant="outline" className="text-[10px] capitalize">
                {m}
              </Badge>
            ))}
          </div>
        )}

        {/* ── Account Info ─────────────────────────── */}
        <Separator />
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" />
            Account
          </h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <span className="text-muted-foreground">ID:</span>{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                {item.owner_id?.slice(0, 12)}…
              </code>
            </p>
            {item.buyer_verification_required && (
              <p className="flex items-center gap-1 text-amber-600">
                <ShieldCheck className="h-3.5 w-3.5" />
                Buyer verification required
              </p>
            )}
          </div>
        </div>

        {/* ── Submission Time ──────────────────────── */}
        <p className="text-xs text-muted-foreground">
          Submitted {formatRelativeTime(item.created_at)}
        </p>
      </div>
    </ScrollArea>
  );
}
