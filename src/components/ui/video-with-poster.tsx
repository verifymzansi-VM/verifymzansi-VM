"use client";

import { useCallback, useEffect, useRef, useState, type VideoHTMLAttributes } from "react";
import { Play, RotateCcw, AlertTriangle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";

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
  /** Controls whether poster/video media contain fully or crop to fill. */
  mediaFit?: "contain" | "cover";
  /** Extra class names applied to the outer wrapper div */
  wrapperClassName?: string;
  /** Class names applied to the play-button overlay */
  playButtonClassName?: string;
}

function getMediaFitClassName(mediaFit: "contain" | "cover") {
  return mediaFit === "contain" ? "object-contain bg-black" : "object-cover";
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
  mediaFit = "contain",
  wrapperClassName,
  playButtonClassName,
  className,
  ...videoProps
}: VideoWithPosterProps) {
  const [activated, setActivated] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [posterErrorForSrc, setPosterErrorForSrc] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const posterError = Boolean(posterUrl && posterErrorForSrc === posterUrl);
  const manager = useVideoPlaybackManager();
  const mediaFitClassName = getMediaFitClassName(mediaFit);

  /* ---- Register with global playback manager when video is active ---- */
  useEffect(() => {
    const video = videoRef.current;
    if (!activated || !video) return;

    manager.register(video);
    manager.requestPriority(video);

    return () => {
      manager.releasePriority(video);
      manager.unregister(video);
    };
  }, [activated, manager, retryCount]);

  /** Ref callback: set src when the <video> mounts (manager handles playback) */
  const mountVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (node && src) {
        node.src = src;
      }
    },
    [src]
  );

  /** Reset error state and try again */
  const handleRetry = useCallback(() => {
    setHasError(false);
    setRetryCount((c) => c + 1);
    setActivated(true);
  }, []);

  /** Video error handler — fall back to poster + retry UI */
  const handleError = useCallback(() => {
    setHasError(true);
    setActivated(false);
  }, []);

  const handlePosterError = useCallback(() => {
    setPosterErrorForSrc(posterUrl ?? null);
  }, [posterUrl]);

  /* ---- Error state: show poster with retry button ---- */
  if (hasError) {
    const showDownload = retryCount >= 1;
    return (
      <div className={cn("relative select-none", wrapperClassName)}>
        {/* Cover image or gradient placeholder */}
        {posterUrl && !posterError ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={posterUrl}
            alt={posterAlt}
            className={cn("w-full h-full", mediaFitClassName, className)}
            draggable={false}
            onErrorCapture={handlePosterError}
          />
        ) : (
          <div
            className={cn(
              "w-full h-full bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800",
              className
            )}
          />
        )}

        {/* Error overlay with retry + download */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-2",
            "bg-black/40 backdrop-blur-sm",
            playButtonClassName
          )}
        >
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <span className="text-xs font-medium text-white/90">Video failed to load</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white shadow-lg transition-transform hover:scale-110"
              aria-label="Retry playing video"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            {showDownload && (
              <a
                href={src}
                download
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white shadow-lg transition-transform hover:scale-110"
                aria-label="Download video"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-4 w-4" />
              </a>
            )}
          </div>
          {showDownload && (
            <span className="text-[10px] text-white/60">
              Format may not be supported in-browser
            </span>
          )}
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
        className={cn(mediaFitClassName, className)}
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
      className={cn(
        "relative cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green-500",
        wrapperClassName
      )}
      onClick={() => setActivated(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setActivated(true);
        }
      }}
    >
      {/* Cover image or gradient placeholder */}
      {posterUrl && !posterError ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={posterUrl}
          alt={posterAlt}
          className={cn("w-full h-full", mediaFitClassName, className)}
          draggable={false}
          onErrorCapture={handlePosterError}
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
