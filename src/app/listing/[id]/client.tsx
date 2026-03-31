"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Play, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoWithPoster } from "@/components/ui/video-with-poster";
import { cn } from "@/lib/utils";
import { normalizeMediaUrls } from "@/lib/utils/media-url";

interface ListingDetailClientProps {
  photos: string[];
  videos: string[];
  title: string;
  listingId: string;
  videoThumbnail?: string | null;
  /** When set, items at index >= photoCount are treated as videos (needed for blob URLs with no extension). */
  photoCount?: number;
}

type MediaKind = "photo" | "video";

interface MediaItem {
  kind: MediaKind;
  url: string;
}

function isBlobOrDataUrl(url: string): boolean {
  return url.startsWith("blob:") || url.startsWith("data:");
}

function isRenderableMediaUrl(url: string): boolean {
  return url.trim().length > 0;
}

/** Small thumbnail placeholder for videos in the thumbnail strip */
function VideoThumbnailThumb({ firstPhoto }: { firstPhoto?: string }) {
  const useUnoptimizedImage = firstPhoto ? isBlobOrDataUrl(firstPhoto) : false;

  return firstPhoto ? (
    <div className="relative w-full h-full">
      <Image
        src={firstPhoto}
        alt="Video thumbnail"
        width={80}
        height={80}
        className="w-full h-full object-cover"
        unoptimized={useUnoptimizedImage ? true : undefined}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
        <Play className="h-4 w-4 text-white fill-white" />
      </div>
    </div>
  ) : (
    <div className="w-full h-full bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800 flex items-center justify-center">
      <Play className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

export function ListingDetailClient({
  photos,
  videos,
  title,
  listingId,
  videoThumbnail,
  photoCount,
}: ListingDetailClientProps) {
  const normalizedPhotos = normalizeMediaUrls(photos).filter(Boolean);
  const normalizedVideos = normalizeMediaUrls(videos).filter(Boolean);
  const sourceOrderedMedia: MediaItem[] =
    photoCount != null
      ? [...normalizedPhotos, ...normalizedVideos].map((url, index) => ({
          url,
          kind: index < photoCount ? "photo" : "video",
        }))
      : [
          ...normalizedPhotos.map((url) => ({ url, kind: "photo" as const })),
          ...normalizedVideos.map((url) => ({ url, kind: "video" as const })),
        ];
  const orderedMedia = [
    ...sourceOrderedMedia.filter((item) => item.kind === "video"),
    ...sourceOrderedMedia.filter((item) => item.kind === "photo"),
  ];
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  // Use videoThumbnail if available, then fall back to first photo
  const firstPhotoUrl =
    (videoThumbnail ? normalizeMediaUrls([videoThumbnail])[0] : undefined) ||
    normalizedPhotos[0] ||
    undefined;
  const activeMedia = orderedMedia[activeIndex];
  const activeUrl = activeMedia?.url || "";
  const hasActiveUrl = isRenderableMediaUrl(activeUrl);
  const isVideo = activeMedia?.kind === "video";
  const shouldUseUnoptimizedImage = isBlobOrDataUrl(activeUrl);

  function goTo(index: number) {
    if (index >= 0 && index < orderedMedia.length) {
      setActiveIndex(index);
    }
  }

  async function copyShareLink() {
    try {
      const url = `${window.location.origin}/listing/${listingId}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  if (orderedMedia.length === 0) {
    return (
      <div className="aspect-video rounded-xl bg-muted flex items-center justify-center">
        <p className="text-muted-foreground">No images</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Main Image / Video ──────────────────────────── */}
      <div className="relative group rounded-xl overflow-hidden bg-warm-100 dark:bg-warm-800">
        <div className="aspect-video relative">
          {!hasActiveUrl ? (
            <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground text-sm">
              Media could not load
            </div>
          ) : isVideo ? (
            <VideoWithPoster
              key={activeUrl}
              src={activeUrl}
              posterUrl={firstPhotoUrl}
              controls
              playsInline
              className="w-full h-full object-contain bg-black rounded-xl"
              wrapperClassName="w-full h-full"
            />
          ) : (
            <Image
              src={activeUrl}
              alt={`${title} - ${activeMedia?.kind ?? "photo"} ${activeIndex + 1}`}
              fill
              className="object-cover transition-transform duration-500"
              sizes="(max-width: 1024px) 100vw, 66vw"
              priority={activeIndex === 0}
              unoptimized={shouldUseUnoptimizedImage ? true : undefined}
            />
          )}

          {/* Navigation arrows */}
          {orderedMedia.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => goTo(activeIndex - 1)}
                disabled={activeIndex === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => goTo(activeIndex + 1)}
                disabled={activeIndex === orderedMedia.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 hover:bg-black/60"
                aria-label="Next image"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          {/* Image counter */}
          {orderedMedia.length > 1 && (
            <div className="absolute bottom-3 right-3 bg-black/50 text-white text-xs font-medium px-2.5 py-1 rounded-full backdrop-blur-sm">
              {activeIndex + 1} / {orderedMedia.length}
            </div>
          )}
        </div>
      </div>

      {/* ── Thumbnail Strip ─────────────────────────────── */}
      {orderedMedia.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {orderedMedia.map((item, i) => {
            const isVid = item.kind === "video";
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActiveIndex(i)}
                aria-label={`View ${item.kind} ${i + 1} of ${orderedMedia.length}`}
                className={cn(
                  "relative flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border-2 transition-all duration-200",
                  i === activeIndex
                    ? "border-brand-green ring-2 ring-brand-green/20 shadow-md"
                    : "border-transparent hover:border-brand-green/40 opacity-60 hover:opacity-100"
                )}
              >
                {isVid ? (
                  <VideoThumbnailThumb firstPhoto={firstPhotoUrl} />
                ) : (
                  <Image
                    src={item.url}
                    alt={`Thumbnail ${i + 1}`}
                    fill
                    className="object-cover"
                    sizes="80px"
                    unoptimized={isBlobOrDataUrl(item.url) ? true : undefined}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Share Button ─────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={copyShareLink}>
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-brand-green" />
              Link Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy Link
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
