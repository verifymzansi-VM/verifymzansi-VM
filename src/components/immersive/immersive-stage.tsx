"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Maximize2, Play } from "lucide-react";
import { BrandShield } from "@/components/shared/brand-shield";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { ProfileVideoPlayer } from "@/components/ui/profile-video-player";
import { VideoViewTracker } from "@/components/ui/video-view-tracker";
import { useHorizontalSwipeNavigation } from "@/hooks/use-horizontal-swipe-navigation";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useDataSaver } from "@/hooks/use-data-saver";
import type { FeedSlide } from "@/lib/feed/types";
import { cn } from "@/lib/utils";

/** How long a photo stays before the next photo or video of the same post. */
const PHOTO_SECONDS = 6;
const MEDIA_SIZES =
  "(min-width: 1280px) min(calc(100dvh * 0.5625), calc(100vw - 708px)), min(calc(100dvh * 0.5625), calc(100vw - 456px))";
const OPEN_DIALOG = '[role="dialog"]:not([data-state="closed"])';

export type MediaChangeCause = "user" | "auto";

const ARROW_CLASS =
  "absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-brand-green-950/70 text-white transition-colors hover:bg-brand-green-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 disabled:pointer-events-none disabled:opacity-0";

/**
 * The centre frame: one post's media at 9:16. Videos come first, then photos;
 * left and right move through them. Only the post on screen mounts a video
 * element, so neighbouring posts never hold a decoder or count a view.
 *
 * Autoplay: a video plays to its end, then the next item shows; a photo stays
 * six seconds. It never leaves the post, and it stops for good once the visitor
 * moves through the media themselves.
 */
export function ImmersiveStage({
  slide,
  active,
  mediaIndex,
  onMediaIndexChange,
  onVideoViewRecorded,
  analytics = true,
  autoplay,
}: {
  slide: FeedSlide;
  active: boolean;
  mediaIndex: number;
  onMediaIndexChange: (index: number, cause: MediaChangeCause) => void;
  onVideoViewRecorded: () => void;
  analytics?: boolean;
  /** Off once the visitor has moved through this post's media themselves. */
  autoplay: boolean;
}) {
  const media = slide.media;
  const index = Math.min(mediaIndex, Math.max(0, media.length - 1));
  const item = media[index];
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const canPrevious = index > 0;
  const canNext = index < media.length - 1;
  const goTo = useCallback(
    (next: number, cause: MediaChangeCause = "user") => {
      if (next >= 0 && next < media.length) onMediaIndexChange(next, cause);
    },
    [media.length, onMediaIndexChange]
  );
  const swipe = useHorizontalSwipeNavigation({
    canPrevious,
    canNext,
    disabled: !active,
    onPrevious: () => goTo(index - 1),
    onNext: () => goTo(index + 1),
  });

  const reducedMotion = useReducedMotion();
  const dataSaver = useDataSaver();
  const autoRunning =
    active && autoplay && canNext && !reducedMotion && !dataSaver && !lightboxOpen;
  const photoTimerRunning = autoRunning && item?.kind === "photo";
  // Restarts the photo countdown (and its progress bar) after the tab was hidden.
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    if (!photoTimerRunning) return;
    let timer: number | null = null;
    const arm = (delay: number) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Never change photo under an open dialog; look again shortly.
        if (document.visibilityState !== "visible" || document.querySelector(OPEN_DIALOG)) {
          arm(1000);
          return;
        }
        goTo(index + 1, "auto");
      }, delay);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        if (timer) window.clearTimeout(timer);
        return;
      }
      setRunKey((key) => key + 1);
      arm(PHOTO_SECONDS * 1000);
    };
    arm(PHOTO_SECONDS * 1000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [photoTimerRunning, index, goTo]);

  if (!item) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-brand-green-900 px-8 text-center">
        <BrandShield className="h-14 w-14 text-brand-gold-300" aria-hidden="true" />
        <p className="font-display text-lg font-semibold text-white">{slide.title}</p>
        <p className="text-sm text-white/60">No photos or video were added to this post.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" {...swipe}>
      {item.kind === "video" ? (
        active ? (
          <VideoViewTracker
            targetId={slide.id}
            targetType={slide.targetType}
            surface={`feed:${slide.vertical}`}
            enabled={analytics}
            onRecorded={onVideoViewRecorded}
          >
            <ProfileVideoPlayer
              key={item.url}
              // While autoplay can move on, the video plays once; otherwise it loops.
              loop={!autoRunning}
              onEnded={() => {
                if (autoRunning) goTo(index + 1, "auto");
              }}
              src={item.url}
              poster={item.poster}
              posterSizes={MEDIA_SIZES}
              title={slide.title}
              mediaFit="contain"
              skipSeconds={10}
              showErrorState
              className="bg-black"
            />
          </VideoViewTracker>
        ) : (
          <div className="absolute inset-0 bg-black">
            {item.poster ? (
              <Image src={item.poster} alt="" fill sizes={MEDIA_SIZES} className="object-contain" />
            ) : null}
            <span className="absolute inset-0 flex items-center justify-center">
              <Play className="h-12 w-12 fill-white/80 text-white/80" aria-hidden="true" />
            </span>
          </div>
        )
      ) : (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="absolute inset-0 block overflow-hidden bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gold-300"
          aria-label={`Open photo ${index + 1} of ${media.length} full screen`}
          tabIndex={active ? 0 : -1}
        >
          {/* Same photo, blurred, fills the frame behind a photo of another shape. */}
          <Image
            src={item.url}
            alt=""
            fill
            sizes="120px"
            className="scale-110 object-cover opacity-50 blur-2xl"
            aria-hidden="true"
          />
          <Image
            src={item.url}
            alt={`${slide.title}, photo ${index + 1}`}
            fill
            sizes={MEDIA_SIZES}
            priority={active}
            className="object-contain"
          />
        </button>
      )}

      {photoTimerRunning ? (
        <span
          key={`${index}-${runKey}`}
          className="immersive-photo-timer pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 origin-left bg-brand-gold-300"
          style={{ animationDuration: `${PHOTO_SECONDS}s` }}
          aria-hidden="true"
        />
      ) : null}

      {media.length > 1 ? (
        <>
          <span className="absolute left-3 top-3 z-10 rounded-full bg-brand-green-950/70 px-2.5 py-1 text-xs font-semibold tabular-nums text-white">
            {index + 1} / {media.length}
          </span>
          <button
            type="button"
            data-carousel-control="true"
            className={cn(ARROW_CLASS, "left-3")}
            onClick={() => goTo(index - 1)}
            disabled={!canPrevious}
            aria-label="Previous photo or video"
            tabIndex={active ? 0 : -1}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-carousel-control="true"
            className={cn(ARROW_CLASS, "right-3")}
            onClick={() => goTo(index + 1)}
            disabled={!canNext}
            aria-label="Next photo or video"
            tabIndex={active ? 0 : -1}
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </>
      ) : null}

      {/* Videos have their own full-screen control in the player. */}
      {item.kind === "photo" ? (
        <button
          type="button"
          data-carousel-control="true"
          onClick={() => setLightboxOpen(true)}
          className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-brand-green-950/70 text-white transition-colors hover:bg-brand-green-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
          aria-label="View full screen"
          tabIndex={active ? 0 : -1}
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}

      {active ? (
        <MediaLightbox
          items={media}
          startIndex={index}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </div>
  );
}
