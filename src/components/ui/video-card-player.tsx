"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Volume2, VolumeX, Maximize2, Play, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { useVideoVisibility } from "@/hooks/use-video-visibility";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Check if a URL points to a video file by extension. */
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    url
      .split("?")[0]
      .toLowerCase()
      .match(/\.(mp4|webm|ogg)$/) != null
  );
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface VideoCardPlayerProps {
  /** Raw media URL (may be video or image — detected automatically) */
  src: string | null | undefined;
  /** Optional poster image shown before the video is ready */
  posterUrl?: string | null;
  /** Alt text for the poster image */
  alt?: string;
  /** Image sizing hint for Next.js Image component */
  sizes?: string;
  /** Extra class on the outer wrapper */
  className?: string;
  /** Class on the <video> / image transition (e.g. `group-hover:scale-110`) */
  mediaClassName?: string;
  /** Whether to show the hover‑scale effect */
  hoverScale?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Reusable auto-play video thumbnail for card components.
 *
 * Encapsulates:
 * - Video URL detection via extension
 * - Lazy-loading via IntersectionObserver (`useVideoVisibility`)
 * - Poster fade-out when video is ready
 * - Mute toggle (top-right)
 * - Fullscreen activation (centre)
 * - Error fallback with retry UI
 * - `prefers-reduced-motion` support (via hook)
 * - Accessible labels on all interactive controls
 *
 * If the `src` is **not** a video URL the component delegates to
 * Next.js `<Image>` with the same sizing props.
 */
export function VideoCardPlayer({
  src,
  posterUrl,
  alt = "Media",
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw",
  className,
  mediaClassName,
  hoverScale = true,
}: VideoCardPlayerProps) {
  const isVideo = isVideoUrl(src);
  const normalizedSrc = src ? normalizeMediaUrl(src) : undefined;
  const normalizedPoster = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;

  const { videoRef, reducedMotion } = useVideoVisibility(isVideo ? normalizedSrc : undefined);

  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Track when video has rendered its first frame
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlaying = () => setVideoReady(true);
    el.addEventListener("playing", onPlaying);
    return () => el.removeEventListener("playing", onPlaying);
  });

  /* ── Callbacks ──────────────────────────────────────────── */

  const handleVideoClick = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!videoRef.current) return;

      if (videoRef.current.paused) videoRef.current.play();
      setIsMuted(false);
      videoRef.current.muted = false;

      try {
        if (videoRef.current.requestFullscreen) {
          videoRef.current.requestFullscreen();
        } else if (
          (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })
            .webkitEnterFullscreen
        ) {
          (
            videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
          ).webkitEnterFullscreen?.();
        }
      } catch {
        /* fullscreen not supported */
      }
    },
    [videoRef]
  );

  const handleVideoKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        handleVideoClick(e);
      }
    },
    [handleVideoClick]
  );

  const toggleMute = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (videoRef.current) {
        videoRef.current.muted = !videoRef.current.muted;
        setIsMuted(videoRef.current.muted);
      }
    },
    [videoRef]
  );

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  const handleRetry = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setHasError(false);
      setVideoReady(false);
      // Force reload by resetting src
      const el = videoRef.current;
      if (el && normalizedSrc) {
        el.src = "";
        el.src = normalizedSrc;
        el.play().catch(() => {});
      }
    },
    [videoRef, normalizedSrc]
  );

  /* ── Non-video: plain Image ─────────────────────────────── */

  if (!isVideo) {
    if (!normalizedSrc) return null;
    return (
      <Image
        src={normalizedSrc}
        alt={alt}
        fill
        className={cn(
          "object-cover",
          hoverScale && "transition-transform duration-500 group-hover:scale-110",
          mediaClassName
        )}
        sizes={sizes}
      />
    );
  }

  /* ── Video ──────────────────────────────────────────────── */

  const scaleClass = hoverScale
    ? "transition-all duration-500 group-hover:scale-110"
    : "transition-all duration-500";

  return (
    <div className={cn("relative h-full w-full group/video", className)}>
      {/* Poster / cover image — prevents blank space before video loads */}
      {normalizedPoster ? (
        <Image
          src={normalizedPoster}
          alt={alt || "Video cover"}
          fill
          className={cn(
            "object-cover absolute inset-0 z-[1] transition-opacity duration-300",
            videoReady && !hasError ? "opacity-0" : "opacity-100"
          )}
          sizes={sizes}
        />
      ) : !videoReady || hasError ? (
        <div className="absolute inset-0 z-[1] bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800 flex items-center justify-center">
          <Play className="h-10 w-10 text-white/60" />
        </div>
      ) : null}

      {/* Video element */}
      <video
        ref={videoRef}
        preload="none"
        loop
        muted={isMuted}
        playsInline
        aria-label={alt ? `${alt} video` : "Video preview"}
        onError={handleError}
        className={cn(
          "h-full w-full object-cover",
          scaleClass,
          !videoReady || hasError ? "opacity-0" : "opacity-100",
          "z-[2] relative"
        )}
      />

      {/* Error overlay */}
      {hasError && (
        <div
          role="button"
          tabIndex={0}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/40 backdrop-blur-sm cursor-pointer"
          onClick={handleRetry}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleRetry(e);
          }}
          aria-label="Retry loading video"
        >
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <span className="text-xs font-medium text-white/90">Video unavailable</span>
        </div>
      )}

      {/* Reduced-motion notice — show a static play button instead of auto-playing */}
      {reducedMotion && !hasError && (
        <div
          role="button"
          tabIndex={0}
          className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer"
          onClick={handleVideoClick}
          onKeyDown={handleVideoKeyDown}
          aria-label="Play video"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110">
            <Play className="h-5 w-5 fill-white" />
          </div>
        </div>
      )}

      {/* Interactive overlay — mute + fullscreen (hidden during error) */}
      {!hasError && !reducedMotion && (
        <>
          {/* Mobile: always visible controls */}
          <div className="absolute inset-0 z-10 flex sm:hidden flex-col justify-between p-2 bg-black/20">
            <div className="flex justify-end w-full">
              <button
                type="button"
                onClick={toggleMute}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors"
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex items-center justify-center flex-1">
              <button
                type="button"
                onClick={handleVideoClick}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110"
                aria-label="Enter fullscreen"
              >
                <Maximize2 className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Desktop: show on hover */}
          <div
            className="absolute inset-0 z-10 hidden sm:group-hover/video:flex flex-col justify-between p-2 bg-black/20"
            onClick={handleVideoClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleVideoClick(e as unknown as React.MouseEvent);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={isPlaying ? "Pause video" : "Play video"}
          >
            <div className="flex justify-end w-full">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute(e);
                }}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-colors"
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex items-center justify-center flex-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110">
                <Maximize2 className="h-5 w-5" />
              </div>
            </div>
          </div>

          {/* Play indicator (visible when NOT hovered, desktop only) */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-100 group-hover:opacity-0 transition-opacity duration-300 z-[5]">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm">
              <Play className="h-5 w-5 fill-white pr-0.5" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
