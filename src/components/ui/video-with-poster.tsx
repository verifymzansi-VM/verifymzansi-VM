"use client";

import { useCallback, useRef, useState, type VideoHTMLAttributes } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface VideoWithPosterProps extends Omit<
  VideoHTMLAttributes<HTMLVideoElement>,
  "poster"
> {
  /** Video source URL */
  src: string;
  /** Image URL to show as the cover before the video plays (e.g. first listing photo) */
  posterUrl?: string;
  /** Extra class names applied to the outer wrapper div */
  wrapperClassName?: string;
  /** Class names applied to the play-button overlay */
  playButtonClassName?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Click-to-play video component with a fast-loading cover image.
 *
 * Shows `posterUrl` (typically the listing's first photo) with a centred
 * Play button. Clicking swaps in the `<video>` and starts playback.
 * No `<video>` element exists in the DOM until the user clicks, so this
 * component makes **zero** video network requests on page load.
 */
export function VideoWithPoster({
  src,
  posterUrl,
  wrapperClassName,
  playButtonClassName,
  className,
  ...videoProps
}: VideoWithPosterProps) {
  const [activated, setActivated] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /** Ref callback: set src and auto-play when the <video> mounts */
  const mountVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (node && src) {
        node.src = src;
        node.play().catch(() => {
          /* autoplay may be blocked */
        });
      }
    },
    [src]
  );

  /* ---- Activated: render actual <video> ---- */
  if (activated) {
    return <video ref={mountVideo} autoPlay className={className} {...videoProps} />;
  }

  /* ---- Poster / cover image state ---- */
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Play video"
      className={cn("relative cursor-pointer select-none", wrapperClassName)}
      onClick={() => setActivated(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setActivated(true);
        }
      }}
    >
      {/* Cover image or gradient placeholder */}
      {posterUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={posterUrl}
          alt="Video thumbnail"
          className={cn("w-full h-full object-cover", className)}
          draggable={false}
        />
      ) : (
        <div
          className={cn(
            "w-full h-full bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800",
            className
          )}
        />
      )}

      {/* Centred play button overlay */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "bg-black/20 transition-colors hover:bg-black/30",
          playButtonClassName
        )}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm text-white shadow-lg transition-transform hover:scale-110">
          <Play className="h-6 w-6 fill-white" />
        </div>
      </div>
    </div>
  );
}
