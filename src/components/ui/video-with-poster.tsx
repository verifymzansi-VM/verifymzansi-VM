"use client";

import { useCallback, useRef, useState, type VideoHTMLAttributes } from "react";
import { Play, RotateCcw, AlertTriangle } from "lucide-react";
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
  /** Alt text for the poster image (defaults to "Video thumbnail") */
  posterAlt?: string;
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
 *
 * If the video fails to load, the poster is restored with a retry button.
 */
export function VideoWithPoster({
  src,
  posterUrl,
  posterAlt = "Video thumbnail",
  wrapperClassName,
  playButtonClassName,
  className,
  ...videoProps
}: VideoWithPosterProps) {
  const [activated, setActivated] = useState(false);
  const [hasError, setHasError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /** Ref callback: set src and auto-play when the <video> mounts */
  const mountVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (node && src) {
        node.src = src;
        node.play().catch(() => {
          /* autoplay may be blocked — not an error, user can use controls */
        });
      }
    },
    [src]
  );

  /** Reset error state and try again */
  const handleRetry = useCallback(() => {
    setHasError(false);
    setActivated(true);
  }, []);

  /** Video error handler — fall back to poster + retry UI */
  const handleError = useCallback(() => {
    setHasError(true);
    setActivated(false);
  }, []);

  /* ---- Error state: show poster with retry button ---- */
  if (hasError) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Retry playing video"
        className={cn("relative cursor-pointer select-none", wrapperClassName)}
        onClick={handleRetry}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRetry();
          }
        }}
      >
        {/* Cover image or gradient placeholder */}
        {posterUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={posterUrl}
            alt={posterAlt}
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

        {/* Error overlay with retry */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-2",
            "bg-black/40 backdrop-blur-sm",
            playButtonClassName
          )}
        >
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <span className="text-xs font-medium text-white/90">Video failed to load</span>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white shadow-lg transition-transform hover:scale-110">
            <RotateCcw className="h-5 w-5" />
          </div>
        </div>
      </div>
    );
  }

  /* ---- Activated: render actual <video> ---- */
  if (activated) {
    return (
      <video
        ref={mountVideo}
        autoPlay
        controls
        aria-label="Video player"
        className={className}
        onError={handleError}
        {...videoProps}
      />
    );
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
          alt={posterAlt}
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
