"use client";

import { VideoViewTracker } from "@/components/ui/video-view-tracker";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Maximize2,
  Play,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { cn } from "@/lib/utils";
import { normalizeMediaUrls } from "@/lib/utils/media-url";
import { ProfileVideoPlayer } from "@/components/ui/profile-video-player";
import { useHorizontalSwipeNavigation } from "@/hooks/use-horizontal-swipe-navigation";
import { useTrackContentView } from "@/hooks/use-track-content-view";

interface ListingDetailClientProps {
  photos: string[];
  videos: string[];
  title: string;
  listingId: string;
  videoThumbnail?: string | null;
  /** When set, items at index >= photoCount are treated as videos (needed for blob URLs with no extension). */
  photoCount?: number;
  heroAspectClassName?: string;
  heroMediaClassName?: string;
  trackView?: boolean;
  onViewRecorded?: () => void;
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
        className="w-full h-full bg-black object-contain"
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
  heroAspectClassName = "aspect-video",
  heroMediaClassName,
  trackView = true,
  onViewRecorded,
}: ListingDetailClientProps) {
  useTrackContentView(listingId, "listing", trackView, onViewRecorded);
  const normalizedPhotos = normalizeMediaUrls(photos).filter(Boolean);
  const normalizedVideos = normalizeMediaUrls(videos).filter(Boolean);
  const orderedMedia = useMemo(() => {
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
    return [
      ...sourceOrderedMedia.filter((item) => item.kind === "video"),
      ...sourceOrderedMedia.filter((item) => item.kind === "photo"),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, videos, photoCount]);
  const [activeIndex, setActiveIndex] = useState(0);

  /* ---- video controls state ---- */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [videoRetries, setVideoRetries] = useState(0);

  /* ---- lightbox state ---- */
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStart, setLightboxStart] = useState(0);
  const wasPlayingRef = useRef(false);

  const openLightbox = useCallback((idx: number) => {
    const v = videoRef.current;
    wasPlayingRef.current = v ? !v.paused : false;
    setLightboxStart(idx);
    setLightboxOpen(true);
    v?.pause();
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    if (orderedMedia[activeIndex]?.kind === "video" && videoRef.current && wasPlayingRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [activeIndex, orderedMedia]);

  const handleVideoRetry = useCallback(() => {
    setVideoError(false);
    setVideoRetries((c) => c + 1);
  }, []);

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
  const canPrevious = activeIndex > 0;
  const canNext = activeIndex < orderedMedia.length - 1;

  const goTo = useCallback(
    (index: number) => {
      if (index >= 0 && index < orderedMedia.length) {
        setVideoError(false);
        setActiveIndex(index);
      }
    },
    [orderedMedia.length]
  );

  const swipeHandlers = useHorizontalSwipeNavigation({
    canPrevious,
    canNext,
    onPrevious: () => goTo(activeIndex - 1),
    onNext: () => goTo(activeIndex + 1),
  });

  if (orderedMedia.length === 0) {
    return (
      <div
        className={cn(
          heroAspectClassName,
          "flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-border bg-muted/60 text-muted-foreground"
        )}
      >
        <ImageOff className="h-6 w-6" aria-hidden="true" />
        <p className="text-sm">No photos added yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Main Image / Video ──────────────────────────── */}
      <div
        className="group relative touch-pan-y overflow-hidden rounded-3xl bg-warm-950 elev-sm"
        {...swipeHandlers}
      >
        <div className={`${heroAspectClassName} relative`}>
          {!hasActiveUrl ? (
            <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground text-sm">
              Media could not load
            </div>
          ) : isVideo && videoError ? (
            /* ---- Video error state with retry ---- */
            <div className="w-full h-full flex flex-col items-center justify-center bg-black gap-2">
              {firstPhotoUrl && (
                <Image
                  src={firstPhotoUrl}
                  alt="Video thumbnail"
                  fill
                  className="bg-black object-contain opacity-40"
                  sizes="(max-width: 1024px) 100vw, 66vw"
                />
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 backdrop-blur-sm">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                <span className="text-xs font-medium text-white/90">Video failed to load</span>
                <button
                  type="button"
                  onClick={handleVideoRetry}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white shadow-lg transition-transform hover:scale-110"
                  aria-label="Retry"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : isVideo ? (
            /* ---- Autoplay video with custom controls ---- */
            <>
              <VideoViewTracker
                targetId={listingId}
                targetType="listing"
                enabled={trackView}
                onRecorded={onViewRecorded}
              >
                <ProfileVideoPlayer
                  ref={videoRef}
                  key={`${activeUrl}-${videoRetries}`}
                  src={activeUrl}
                  poster={firstPhotoUrl}
                  prioritizePoster={activeIndex === 0}
                  autoPlayOnMobile={false}
                  title={title}
                  onError={() => setVideoError(true)}
                  mediaFit="contain"
                  videoClassName={heroMediaClassName ?? "rounded-xl bg-black object-contain"}
                  skipSeconds={10}
                />
              </VideoViewTracker>
            </>
          ) : (
            /* ---- Photo with click-to-lightbox ---- */
            <button
              type="button"
              className="relative h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
              onClick={() => openLightbox(activeIndex)}
              aria-label={`View ${title} photo fullscreen`}
            >
              {/* Soft blurred fill behind contained photos; desktop only (blur is costly on phones). */}
              {!shouldUseUnoptimizedImage ? (
                <Image
                  src={activeUrl}
                  alt=""
                  aria-hidden="true"
                  fill
                  className="hidden scale-110 object-fill opacity-60 blur-2xl md:block motion-reduce:blur-none"
                  sizes="(max-width: 1024px) 100vw, 66vw"
                />
              ) : null}
              <Image
                src={activeUrl}
                alt={`${title} - ${activeMedia?.kind ?? "photo"} ${activeIndex + 1}`}
                fill
                className={cn(
                  heroMediaClassName ?? "bg-black object-contain transition-transform duration-500"
                )}
                sizes="(max-width: 1024px) 100vw, 66vw"
                priority={activeIndex === 0}
                unoptimized={shouldUseUnoptimizedImage ? true : undefined}
              />
              {/* Expand affordance */}
              <div className="absolute bottom-3 right-3 z-10 rounded-full bg-black/55 p-2 text-white transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </div>
            </button>
          )}

          {/* Navigation arrows */}
          {orderedMedia.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => goTo(activeIndex - 1)}
                disabled={activeIndex === 0}
                className="absolute left-2 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-0"
                aria-label="Previous image"
                data-carousel-control="true"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => goTo(activeIndex + 1)}
                disabled={activeIndex === orderedMedia.length - 1}
                className="absolute right-2 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-0"
                aria-label="Next image"
                data-carousel-control="true"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          {/* Image counter */}
          {orderedMedia.length > 1 && (
            <div className="absolute left-3 top-3 z-10 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white">
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
                onClick={() => goTo(i)}
                aria-label={`View ${item.kind} ${i + 1} of ${orderedMedia.length}`}
                aria-current={i === activeIndex ? "true" : undefined}
                className={cn(
                  "relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border-2 bg-warm-950 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-20 sm:w-20",
                  i === activeIndex
                    ? "border-brand-green-600 shadow-md"
                    : "border-transparent opacity-70 hover:opacity-100"
                )}
              >
                {isVid ? (
                  <VideoThumbnailThumb firstPhoto={firstPhotoUrl} />
                ) : (
                  <Image
                    src={item.url}
                    alt={`Thumbnail ${i + 1}`}
                    fill
                    className="object-contain"
                    sizes="80px"
                    unoptimized={isBlobOrDataUrl(item.url) ? true : undefined}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Media Lightbox ──────────────────────────────── */}
      <VideoViewTracker
        targetId={listingId}
        targetType="listing"
        enabled={trackView}
        onRecorded={onViewRecorded}
      >
        <MediaLightbox
          items={orderedMedia.map((m) => ({
            url: m.url,
            kind: m.kind,
            poster: m.kind === "video" ? firstPhotoUrl : undefined,
          }))}
          startIndex={lightboxStart}
          isOpen={lightboxOpen}
          onClose={closeLightbox}
        />
      </VideoViewTracker>
    </div>
  );
}
