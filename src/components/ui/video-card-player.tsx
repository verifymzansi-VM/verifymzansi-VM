"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { Volume2, VolumeX, Play, Pause, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import {
  getFocalPositionClassName,
  getProgressWidthClassName,
} from "@/lib/utils/media-position-classes";
import { useHoverCapability } from "@/hooks/use-hover-capability";
import { useVideoVisibility } from "@/hooks/use-video-visibility";
import { useVideoHover } from "@/hooks/use-video-hover";
import { useVideoFeed } from "@/hooks/use-video-feed";
import { useGlobalMute } from "@/hooks/use-global-mute";

const DEFAULT_MEDIA_FIT = "object-cover";
const DEFAULT_CONTAINER_ASPECT_RATIO = 9 / 16;
const SMART_FIT_CROP_THRESHOLD = 0.2;

export type MediaFitStrategy = "cover" | "smart" | "contain";
export type MuteControlVisibility = "auto" | "always" | "hidden";
export type MediaControlVariant = "default" | "hero";

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
      .match(/\.(mp4|webm|ogg|mov)$/) != null
  );
}

function getCropRatio(mediaAspectRatio: number, containerAspectRatio: number) {
  if (!mediaAspectRatio || !containerAspectRatio) return 0;

  if (mediaAspectRatio > containerAspectRatio) {
    return 1 - containerAspectRatio / mediaAspectRatio;
  }

  return 1 - mediaAspectRatio / containerAspectRatio;
}

function shouldUseSmartFit(
  fitStrategy: MediaFitStrategy,
  mediaAspectRatio: number | null,
  containerAspectRatio: number
) {
  if (fitStrategy === "contain") return true;
  if (fitStrategy !== "smart" || !mediaAspectRatio) return false;
  return getCropRatio(mediaAspectRatio, containerAspectRatio) > SMART_FIT_CROP_THRESHOLD;
}

function getForegroundMediaClassName(
  baseFitClassName: string,
  usesSmartFit: boolean,
  mediaClassName?: string
) {
  return cn(
    usesSmartFit ? "object-contain" : baseFitClassName,
    usesSmartFit && "shadow-[0_0_24px_rgba(15,23,42,0.22)]",
    mediaClassName
  );
}

function getAnimatedMediaClassName(
  baseFitClassName: string,
  usesSmartFit: boolean,
  hoverScale: boolean,
  mediaClassName?: string
) {
  return cn(
    getForegroundMediaClassName(baseFitClassName, usesSmartFit, mediaClassName),
    hoverScale && !usesSmartFit
      ? "transition-transform duration-500 group-hover:scale-110"
      : "transition-transform duration-500"
  );
}

function SmartFitBackdrop({
  src,
  sizes,
  priority,
}: {
  src?: string;
  sizes: string;
  priority: boolean;
}) {
  const useUnoptimized = src ? src.startsWith("blob:") || src.startsWith("data:") : false;

  if (!src) {
    return (
      <>
        <div className="absolute inset-0 bg-gradient-to-br from-warm-200 via-warm-100 to-warm-300 dark:from-warm-800 dark:via-warm-900 dark:to-warm-950" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-12 w-12 rounded-full bg-warm-300/50 dark:bg-warm-700/50 skeleton-shimmer" />
        </div>
      </>
    );
  }

  return (
    <>
      <Image
        src={src}
        alt=""
        aria-hidden="true"
        fill
        className="absolute inset-0 scale-110 object-cover blur-2xl brightness-90 dark:brightness-110 saturate-150"
        sizes={sizes}
        priority={priority}
        unoptimized={useUnoptimized ? true : undefined}
      />
      <div className="absolute inset-0 bg-black/10" />
    </>
  );
}

function MuteButton({
  videoRef,
  showMuteControl,
  controlVariant = "default",
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  showMuteControl: boolean;
  controlVariant?: MediaControlVariant;
}) {
  const { isMuted, toggleMute } = useGlobalMute(videoRef);

  if (!showMuteControl) return null;

  return (
    <div className="absolute right-1 top-1 z-[14] sm:right-2.5 sm:top-2.5">
      {/* Outer padding keeps 44px tap target on mobile while the visible circle is compact */}
      <button
        type="button"
        data-carousel-control="true"
        onPointerDown={(e) => {
          e.preventDefault(); // Prevents selection and mobile zoom delays
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleMute();
        }}
        className={cn(
          "flex items-center justify-center rounded-full text-white shadow-lg backdrop-blur-md transition-colors select-none touch-manipulation",
          controlVariant === "hero"
            ? "border border-white/25 bg-black/48 ring-1 ring-white/10 hover:bg-black/58 h-9 w-9 p-0 sm:min-h-[46px] sm:min-w-[46px]"
            : "border border-white/10 bg-black/55 hover:bg-black/70 h-7 w-7 p-2 -m-2 sm:h-auto sm:w-auto sm:min-h-[44px] sm:min-w-[44px] sm:p-0 sm:m-0"
        )}
        aria-label={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? (
          <VolumeX
            className={cn(controlVariant === "hero" ? "h-4 w-4" : "h-3 w-3 sm:h-4 sm:w-4")}
          />
        ) : (
          <Volume2
            className={cn(controlVariant === "hero" ? "h-4 w-4" : "h-3 w-3 sm:h-4 sm:w-4")}
          />
        )}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface VideoCardPlayerProps {
  /** Raw media URL (may be video or image — detected automatically) */
  src: string | null | undefined;
  /** Explicitly treat media as video when URL has no extension (e.g. blob previews). */
  isVideo?: boolean;
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
  /** Object-fit classes for poster/image/video media */
  mediaFitClassName?: string;
  /** Presentation mode for cards versus interactive previews.
   *  - `"ambient"`: auto-plays muted when visible in viewport
   *  - `"hover"`: lazy-loads on viewport visibility, plays on mouse hover
   *  - `"interactive"`: click-to-play with fullscreen + mute controls
   */
  mode?: "interactive" | "ambient" | "hover";
  /** Marks the fallback image as priority */
  priority?: boolean;
  /** Fit strategy for media in constrained frames. */
  fitStrategy?: MediaFitStrategy;
  /** Aspect ratio of the media frame when using smart fit. */
  containerAspectRatio?: number;
  /** Controls whether the mute toggle should stay visible. */
  muteControlVisibility?: MuteControlVisibility;
  /** Shows a persistent play/pause toggle for ambient video previews. */
  showPlaybackControl?: boolean;
  /** Optional visual treatment for the mute/audio control. */
  controlVariant?: MediaControlVariant;
  /** Keeps ambient videos poster-only until the user explicitly starts playback. */
  deferVideoLoadUntilPlay?: boolean;
  /** Notifies callers when the ambient playback control changes state. */
  onPlaybackStateChange?: (isPlaying: boolean) => void;
  /** Called when the video reaches the end (only fires when loop is disabled). */
  onEnded?: () => void;
  /** Horizontal focal point (0–1, left to right). */
  focalX?: number | null;
  /** Vertical focal point (0–1, top to bottom). */
  focalY?: number | null;
  /** Gates touch-feed autoplay to cards that are currently in focus within a rail. */
  feedPlaybackActive?: boolean;
  /** Prevent native browser dragging on image/video surfaces so parent carousels can own the gesture. */
  disableNativeDrag?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function VideoCardPlayer({
  src,
  isVideo,
  posterUrl,
  alt = "Media",
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw",
  className,
  mediaClassName,
  hoverScale = true,
  mediaFitClassName = DEFAULT_MEDIA_FIT,
  mode = "interactive",
  priority = false,
  fitStrategy = "contain",
  containerAspectRatio = DEFAULT_CONTAINER_ASPECT_RATIO,
  muteControlVisibility = "auto",
  showPlaybackControl = false,
  controlVariant = "default",
  deferVideoLoadUntilPlay = false,
  onPlaybackStateChange,
  onEnded,
  focalX,
  focalY,
  feedPlaybackActive = true,
  disableNativeDrag = false,
}: VideoCardPlayerProps) {
  const isVideoMedia = isVideo ?? isVideoUrl(src);
  const normalizedSrc = src ? normalizeMediaUrl(src) : undefined;
  const normalizedPoster = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const canHover = useHoverCapability();
  const effectiveMode = mode === "hover" && !canHover ? "ambient" : mode;
  // Exclude effectiveMode from the key so that the canHover hydration flip
  // (false → true) does not unmount/remount the player and restart image loads.
  const mediaKey = `${normalizedSrc ?? "none"}|${normalizedPoster ?? "none"}|${showPlaybackControl ? "controls" : "no-controls"}`;

  if (effectiveMode === "hover" && isVideoMedia) {
    return (
      <HoverVideoPlayer
        key={mediaKey}
        normalizedSrc={normalizedSrc}
        normalizedPoster={normalizedPoster}
        alt={alt}
        sizes={sizes}
        className={className}
        mediaClassName={mediaClassName}
        hoverScale={hoverScale}
        mediaFitClassName={mediaFitClassName}
        priority={priority}
        fitStrategy={fitStrategy}
        containerAspectRatio={containerAspectRatio}
        muteControlVisibility={muteControlVisibility}
        focalX={focalX}
        focalY={focalY}
        disableNativeDrag={disableNativeDrag}
      />
    );
  }

  // Touch-device feed mode: tap-to-toggle with auto-play on scroll visibility.
  // Applies when a hover card falls back to ambient on touch devices, or when
  // ambient mode is used directly on a touch device with a video.
  // Excludes showroom/carousel players that have explicit playback controls.
  const isTouchFeed =
    isVideoMedia &&
    !canHover &&
    !showPlaybackControl &&
    (effectiveMode === "ambient" || mode === "hover");

  if (isTouchFeed) {
    return (
      <FeedVideoPlayer
        key={mediaKey}
        normalizedSrc={normalizedSrc}
        normalizedPoster={normalizedPoster}
        alt={alt}
        sizes={sizes}
        className={className}
        mediaClassName={mediaClassName}
        hoverScale={hoverScale}
        mediaFitClassName={mediaFitClassName}
        priority={priority}
        fitStrategy={fitStrategy}
        containerAspectRatio={containerAspectRatio}
        muteControlVisibility={muteControlVisibility}
        focalX={focalX}
        focalY={focalY}
        onEnded={onEnded}
        feedPlaybackActive={feedPlaybackActive}
        disableNativeDrag={disableNativeDrag}
      />
    );
  }

  return (
    <VideoCardPlayerInner
      key={mediaKey}
      isVideo={isVideoMedia}
      normalizedSrc={normalizedSrc}
      normalizedPoster={normalizedPoster}
      alt={alt}
      sizes={sizes}
      className={className}
      mediaClassName={mediaClassName}
      hoverScale={hoverScale}
      mediaFitClassName={mediaFitClassName}
      mode={effectiveMode === "hover" ? "ambient" : effectiveMode}
      priority={priority}
      canHover={canHover}
      fitStrategy={fitStrategy}
      containerAspectRatio={containerAspectRatio}
      muteControlVisibility={muteControlVisibility}
      showPlaybackControl={showPlaybackControl}
      controlVariant={controlVariant}
      deferVideoLoadUntilPlay={deferVideoLoadUntilPlay}
      onPlaybackStateChange={onPlaybackStateChange}
      onEnded={onEnded}
      focalX={focalX}
      focalY={focalY}
      disableNativeDrag={disableNativeDrag}
    />
  );
}

function getInitialAmbientPlaybackPaused(
  mode: "interactive" | "ambient",
  showPlaybackControl: boolean,
  deferVideoLoadUntilPlay: boolean
) {
  if (mode === "ambient" && showPlaybackControl && deferVideoLoadUntilPlay) {
    return true;
  }

  if (mode !== "ambient" || !showPlaybackControl || typeof window === "undefined") {
    return false;
  }

  if (typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface VideoCardPlayerInnerProps {
  isVideo: boolean;
  normalizedSrc?: string;
  normalizedPoster?: string;
  alt: string;
  sizes: string;
  className?: string;
  mediaClassName?: string;
  hoverScale: boolean;
  mediaFitClassName: string;
  mode: "interactive" | "ambient";
  priority: boolean;
  canHover: boolean;
  fitStrategy: MediaFitStrategy;
  containerAspectRatio: number;
  muteControlVisibility: MuteControlVisibility;
  showPlaybackControl: boolean;
  controlVariant: MediaControlVariant;
  deferVideoLoadUntilPlay: boolean;
  onPlaybackStateChange?: (isPlaying: boolean) => void;
  onEnded?: () => void;
  focalX?: number | null;
  focalY?: number | null;
  disableNativeDrag: boolean;
}

function VideoCardPlayerInner({
  isVideo,
  normalizedSrc,
  normalizedPoster,
  alt,
  sizes,
  className,
  mediaClassName,
  hoverScale,
  mediaFitClassName,
  mode,
  priority,
  canHover: _canHover,
  fitStrategy,
  containerAspectRatio,
  muteControlVisibility,
  showPlaybackControl,
  controlVariant,
  deferVideoLoadUntilPlay,
  onPlaybackStateChange,
  onEnded,
  focalX,
  focalY,
  disableNativeDrag,
}: VideoCardPlayerInnerProps) {
  const posterNeedsUnoptimized =
    normalizedPoster?.startsWith("blob:") || normalizedPoster?.startsWith("data:");
  const srcNeedsUnoptimized =
    normalizedSrc?.startsWith("blob:") || normalizedSrc?.startsWith("data:");

  const [isPlaybackPaused, setIsPlaybackPaused] = useState(() =>
    getInitialAmbientPlaybackPaused(mode, showPlaybackControl, deferVideoLoadUntilPlay)
  );
  const [hasActivatedPlayback, setHasActivatedPlayback] = useState(false);
  const [tapIndicator, setTapIndicator] = useState<{
    key: number;
    action: "play" | "pause";
  } | null>(null);
  const managedVideoSrc =
    isVideo && deferVideoLoadUntilPlay && !hasActivatedPlayback ? undefined : normalizedSrc;
  const shouldAutoplay = !isPlaybackPaused;
  const { videoRef, reducedMotion } = useVideoVisibility(managedVideoSrc, shouldAutoplay);
  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  const usesSmartFit = shouldUseSmartFit(fitStrategy, mediaAspectRatio, containerAspectRatio);
  const focalPositionClassName = !usesSmartFit
    ? getFocalPositionClassName(focalX, focalY)
    : undefined;
  const backgroundMediaSrc = normalizedPoster || normalizedSrc;
  const animatedMediaClassName = getAnimatedMediaClassName(
    mediaFitClassName,
    usesSmartFit,
    hoverScale,
    mediaClassName
  );
  const foregroundMediaClassName = getForegroundMediaClassName(
    mediaFitClassName,
    usesSmartFit,
    mediaClassName
  );
  const showMuteControl =
    isVideo &&
    muteControlVisibility !== "hidden" &&
    !hasError &&
    !reducedMotion &&
    (muteControlVisibility === "always" || mode === "interactive");
  const showPlaybackToggle = isVideo && mode === "ambient" && showPlaybackControl && !hasError;
  const canDisplayVideo = !reducedMotion || hasActivatedPlayback;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onPlaying = () => setVideoReady(true);
    const onPlay = () => {
      setHasActivatedPlayback(true);
      setIsPlaying(true);
    };
    const onPause = () => setIsPlaying(false);
    const onLoadedMetadata = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        setMediaAspectRatio(el.videoWidth / el.videoHeight);
      }
    };
    const onEndedNative = () => onEnded?.();

    el.addEventListener("playing", onPlaying);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("ended", onEndedNative);
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("ended", onEndedNative);
    };
  }, [videoRef, onEnded]);

  // Sync external pause/play events (e.g. global manager arbitration) back to
  // the showroom's isActiveVideoPaused state so the slide timer pauses properly.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !onPlaybackStateChange || !showPlaybackControl) return;

    const onExternalPause = () => {
      onPlaybackStateChange(false);
    };
    const onExternalPlay = () => {
      onPlaybackStateChange(true);
    };

    el.addEventListener("pause", onExternalPause);
    el.addEventListener("play", onExternalPlay);
    return () => {
      el.removeEventListener("pause", onExternalPause);
      el.removeEventListener("play", onExternalPlay);
    };
  }, [videoRef, onPlaybackStateChange, showPlaybackControl]);

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setMediaAspectRatio(image.naturalWidth / image.naturalHeight);
    }
    setImageLoaded(true);
  }, []);

  const handlePosterError = useCallback(() => {
    setPosterError(true);
  }, []);

  const handleNativeDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (disableNativeDrag) {
        event.preventDefault();
      }
    },
    [disableNativeDrag]
  );

  const handleVideoClick = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!videoRef.current) return;

      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => {
          /* autoplay may still be blocked */
        });
        setTapIndicator({ key: Date.now(), action: "play" });
      } else {
        videoRef.current.pause();
        setTapIndicator({ key: Date.now(), action: "pause" });
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

  const togglePlayback = useCallback(
    (event: React.SyntheticEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const el = videoRef.current;
      if (!el) return;

      if (isPlaybackPaused) {
        if (!el.src && normalizedSrc) {
          el.src = normalizedSrc;
        }
        // Optimistic play attempt — works when data is already cached.
        // For deferred videos the browser hasn't loaded any data yet, so
        // we also attach a one-shot canplay listener to retry once the
        // browser has buffered enough to begin playback.
        el.play().catch(() => {
          if (el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
            el.addEventListener(
              "canplay",
              () => {
                el.play().catch(() => {
                  /* autoplay policy */
                });
              },
              { once: true }
            );
          }
        });
        setIsPlaybackPaused(false);
        setHasActivatedPlayback(true);
        onPlaybackStateChange?.(true);
        return;
      }

      el.pause();
      setIsPlaybackPaused(true);
      onPlaybackStateChange?.(false);
    },
    [isPlaybackPaused, normalizedSrc, onPlaybackStateChange, videoRef]
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

      const el = videoRef.current;
      if (el && normalizedSrc) {
        el.src = "";
        el.src = normalizedSrc;
        el.addEventListener(
          "canplay",
          () => {
            el.play().catch(() => {
              /* autoplay policy */
            });
          },
          { once: true }
        );
      }
    },
    [videoRef, normalizedSrc]
  );

  if (!isVideo) {
    if (!normalizedSrc || posterError) {
      return <div className="absolute inset-0 skeleton-shimmer" />;
    }

    if (usesSmartFit) {
      return (
        <div
          className={cn("relative h-full w-full", className)}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
        >
          <SmartFitBackdrop src={backgroundMediaSrc} sizes={sizes} priority={priority} />
          {!imageLoaded && <div className="absolute inset-0 z-[1] skeleton-shimmer" />}
          <Image
            src={normalizedSrc}
            alt={alt}
            fill
            className={cn(
              foregroundMediaClassName,
              "transition-opacity duration-300",
              imageLoaded ? "opacity-100" : "opacity-0"
            )}
            sizes={sizes}
            priority={priority}
            onLoad={handleImageLoad}
            onError={handlePosterError}
            data-media-fit="smart"
            unoptimized={srcNeedsUnoptimized ? true : undefined}
            draggable={disableNativeDrag ? false : undefined}
            onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
          />
        </div>
      );
    }

    return (
      <>
        {!imageLoaded && <div className="absolute inset-0 skeleton-shimmer" />}
        <Image
          src={normalizedSrc}
          alt={alt}
          fill
          className={cn(
            animatedMediaClassName,
            "focal-position-object",
            focalPositionClassName,
            "transition-opacity duration-300",
            imageLoaded ? "opacity-100" : "opacity-0"
          )}
          sizes={sizes}
          priority={priority}
          onLoad={handleImageLoad}
          onError={handlePosterError}
          data-media-fit="cover"
          unoptimized={srcNeedsUnoptimized ? true : undefined}
          draggable={disableNativeDrag ? false : undefined}
          onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
        />
      </>
    );
  }

  if (mode === "ambient") {
    return (
      <div
        className={cn("relative h-full w-full", className)}
        data-media-fit={usesSmartFit ? "smart" : "cover"}
      >
        {usesSmartFit ? (
          <SmartFitBackdrop src={backgroundMediaSrc} sizes={sizes} priority={priority} />
        ) : null}

        {normalizedPoster && !posterError ? (
          <Image
            src={normalizedPoster}
            alt={alt || "Video cover"}
            fill
            className={cn(
              "absolute inset-0 z-[2] transition-opacity duration-300",
              foregroundMediaClassName,
              "focal-position-object",
              focalPositionClassName,
              videoReady && !hasError && canDisplayVideo && !isPlaybackPaused
                ? "opacity-0"
                : "opacity-100"
            )}
            sizes={sizes}
            priority={priority}
            onLoad={handleImageLoad}
            onError={handlePosterError}
            data-media-fit={usesSmartFit ? "smart" : "cover"}
            unoptimized={posterNeedsUnoptimized ? true : undefined}
            draggable={disableNativeDrag ? false : undefined}
            onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
          />
        ) : !videoReady || hasError || reducedMotion ? (
          <div className="absolute inset-0 z-[2] skeleton-shimmer" />
        ) : null}

        <video
          ref={videoRef}
          preload="none"
          loop={!onEnded}
          muted
          playsInline
          aria-label={alt ? `${alt} video` : "Video preview"}
          onError={handleError}
          className={cn(
            "absolute inset-0 z-[3] h-full w-full transition-opacity duration-300",
            foregroundMediaClassName,
            "focal-position-object",
            focalPositionClassName,
            hasError || !videoReady || !canDisplayVideo || isPlaybackPaused
              ? "opacity-0"
              : "opacity-100"
          )}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
          draggable={disableNativeDrag ? false : undefined}
          onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
        />

        <MuteButton
          videoRef={videoRef}
          showMuteControl={showMuteControl}
          controlVariant={controlVariant}
        />
        {hasError && showPlaybackToggle ? (
          <div
            role="button"
            tabIndex={0}
            data-carousel-control="true"
            className="absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center gap-2 bg-black/40 backdrop-blur-sm"
            onClick={handleRetry}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleRetry(e);
            }}
            aria-label="Retry loading video"
          >
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <span className="text-xs font-medium text-white/90">Video unavailable</span>
          </div>
        ) : showPlaybackToggle ? (
          <>
            <button
              type="button"
              data-carousel-control="true"
              className="absolute bottom-3 left-1/2 z-[12] inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-black/52 px-3 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/62 sm:bottom-4"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const nextAction = isPlaybackPaused ? "play" : "pause";
                togglePlayback(e);
                setTapIndicator({ key: Date.now(), action: nextAction });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  const nextAction = isPlaybackPaused ? "play" : "pause";
                  togglePlayback(e);
                  setTapIndicator({ key: Date.now(), action: nextAction });
                }
              }}
              aria-label={isPlaybackPaused ? "Play video" : "Pause video"}
            >
              {isPlaybackPaused ? (
                <Play className="h-3.5 w-3.5 fill-white" />
              ) : (
                <Pause className="h-3.5 w-3.5 fill-white" />
              )}
              <span>{isPlaybackPaused ? "Play" : "Pause"}</span>
            </button>
            {tapIndicator ? (
              <FeedTapIndicator key={tapIndicator.key} action={tapIndicator.action} />
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn("relative h-full w-full group/video", className)}
      data-media-fit={usesSmartFit ? "smart" : "cover"}
    >
      {usesSmartFit ? (
        <SmartFitBackdrop src={backgroundMediaSrc} sizes={sizes} priority={priority} />
      ) : null}

      {normalizedPoster && !posterError ? (
        <Image
          src={normalizedPoster}
          alt={alt || "Video cover"}
          fill
          className={cn(
            "absolute inset-0 z-[2] transition-opacity duration-300",
            foregroundMediaClassName,
            "focal-position-object",
            focalPositionClassName,
            videoReady && !hasError && isPlaying ? "opacity-0" : "opacity-100"
          )}
          sizes={sizes}
          priority={priority}
          onLoad={handleImageLoad}
          onError={handlePosterError}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
          unoptimized={posterNeedsUnoptimized ? true : undefined}
          draggable={disableNativeDrag ? false : undefined}
          onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
        />
      ) : !videoReady || hasError || !isPlaying ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center skeleton-shimmer">
          <Play className="h-10 w-10 text-white/60" />
        </div>
      ) : null}

      <video
        ref={videoRef}
        preload="none"
        loop
        muted
        playsInline
        aria-label={alt ? `${alt} video` : "Video preview"}
        onError={handleError}
        className={cn(
          "absolute inset-0 z-[3] h-full w-full transition-opacity duration-300",
          foregroundMediaClassName,
          "focal-position-object",
          focalPositionClassName,
          !videoReady || hasError || !isPlaying ? "opacity-0" : "opacity-100"
        )}
        data-media-fit={usesSmartFit ? "smart" : "cover"}
        draggable={disableNativeDrag ? false : undefined}
        onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
      />

      {hasError && (
        <div
          role="button"
          tabIndex={0}
          className="absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center gap-2 bg-black/40 backdrop-blur-sm"
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

      <MuteButton videoRef={videoRef} showMuteControl={showMuteControl} />

      {reducedMotion && !hasError && (
        <div
          role="button"
          tabIndex={0}
          className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center"
          onClick={handleVideoClick}
          onKeyDown={handleVideoKeyDown}
          aria-label="Play video"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110">
            <Play className="h-5 w-5 fill-white" />
          </div>
        </div>
      )}

      {!hasError && !reducedMotion ? (
        <div
          role="button"
          tabIndex={0}
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={handleVideoClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleVideoClick(e as unknown as React.MouseEvent);
            }
          }}
          aria-label={isPlaying ? "Pause video" : "Play video"}
        />
      ) : null}

      {!hasError && !reducedMotion && !isPlaying ? (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-md">
            <Play className="h-6 w-6 fill-white pl-0.5" />
          </div>
        </div>
      ) : null}

      {tapIndicator ? (
        <FeedTapIndicator key={tapIndicator.key} action={tapIndicator.action} />
      ) : null}
    </div>
  );
}

interface HoverVideoPlayerProps {
  normalizedSrc?: string;
  normalizedPoster?: string;
  alt: string;
  sizes: string;
  className?: string;
  mediaClassName?: string;
  hoverScale: boolean;
  mediaFitClassName: string;
  priority: boolean;
  fitStrategy: MediaFitStrategy;
  containerAspectRatio: number;
  muteControlVisibility: MuteControlVisibility;
  focalX?: number | null;
  focalY?: number | null;
  disableNativeDrag: boolean;
}

function HoverVideoPlayer({
  normalizedSrc,
  normalizedPoster,
  alt,
  sizes,
  className,
  mediaClassName,
  hoverScale,
  mediaFitClassName,
  priority,
  fitStrategy,
  containerAspectRatio,
  muteControlVisibility,
  focalX,
  focalY,
  disableNativeDrag,
}: HoverVideoPlayerProps) {
  const posterNeedsUnoptimized =
    normalizedPoster?.startsWith("blob:") || normalizedPoster?.startsWith("data:");

  const { videoRef, containerRef, reducedMotion, isHovering } = useVideoHover(normalizedSrc);
  const [videoReady, setVideoReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | null>(null);
  const [hoverProgress, setHoverProgress] = useState(0);

  const usesSmartFit = shouldUseSmartFit(fitStrategy, mediaAspectRatio, containerAspectRatio);
  const focalPositionClassName = !usesSmartFit
    ? getFocalPositionClassName(focalX, focalY)
    : undefined;
  const backgroundMediaSrc = normalizedPoster || normalizedSrc;
  const animatedMediaClassName = getAnimatedMediaClassName(
    mediaFitClassName,
    usesSmartFit,
    hoverScale,
    mediaClassName
  );
  const foregroundMediaClassName = getForegroundMediaClassName(
    mediaFitClassName,
    usesSmartFit,
    mediaClassName
  );
  const showMuteControl =
    muteControlVisibility !== "hidden" &&
    !hasError &&
    !reducedMotion &&
    muteControlVisibility === "always";

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onPlaying = () => setVideoReady(true);
    const onLoadedMetadata = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        setMediaAspectRatio(el.videoWidth / el.videoHeight);
      }
    };

    el.addEventListener("playing", onPlaying);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [videoRef]);

  // Track hover playback progress for YouTube-style red progress bar
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !isHovering) return;

    const onTimeUpdate = () => {
      if (el.duration > 0) {
        setHoverProgress((el.currentTime / el.duration) * 100);
      }
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    return () => el.removeEventListener("timeupdate", onTimeUpdate);
  }, [videoRef, isHovering]);

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  const handlePosterError = useCallback(() => {
    setPosterError(true);
  }, []);

  const handleNativeDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (disableNativeDrag) {
        event.preventDefault();
      }
    },
    [disableNativeDrag]
  );

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setMediaAspectRatio(image.naturalWidth / image.naturalHeight);
    }
  }, []);

  if (!normalizedSrc) {
    if (!normalizedPoster || posterError) {
      return <div className="absolute inset-0 skeleton-shimmer" />;
    }

    if (usesSmartFit) {
      return (
        <div
          className={cn("relative h-full w-full", className)}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
        >
          <SmartFitBackdrop src={backgroundMediaSrc} sizes={sizes} priority={priority} />
          <Image
            src={normalizedPoster}
            alt={alt}
            fill
            className={foregroundMediaClassName}
            sizes={sizes}
            priority={priority}
            onLoad={handleImageLoad}
            onError={handlePosterError}
            data-media-fit="smart"
            unoptimized={posterNeedsUnoptimized ? true : undefined}
            draggable={disableNativeDrag ? false : undefined}
            onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
          />
        </div>
      );
    }

    return (
      <Image
        src={normalizedPoster}
        alt={alt}
        fill
        className={cn(animatedMediaClassName, "focal-position-object", focalPositionClassName)}
        sizes={sizes}
        priority={priority}
        onLoad={handleImageLoad}
        onError={handlePosterError}
        data-media-fit="cover"
        unoptimized={posterNeedsUnoptimized ? true : undefined}
        draggable={disableNativeDrag ? false : undefined}
        onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full w-full", className)}
      data-media-fit={usesSmartFit ? "smart" : "cover"}
    >
      {usesSmartFit ? (
        <SmartFitBackdrop src={backgroundMediaSrc} sizes={sizes} priority={priority} />
      ) : null}

      {normalizedPoster && !posterError ? (
        <Image
          src={normalizedPoster}
          alt={alt || "Video cover"}
          fill
          className={cn(
            "absolute inset-0 z-[2] transition-opacity duration-300",
            foregroundMediaClassName,
            "focal-position-object",
            focalPositionClassName,
            isHovering && videoReady && !hasError && !reducedMotion ? "opacity-0" : "opacity-100"
          )}
          sizes={sizes}
          priority={priority}
          onLoad={handleImageLoad}
          onError={handlePosterError}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
          unoptimized={posterNeedsUnoptimized ? true : undefined}
          draggable={disableNativeDrag ? false : undefined}
          onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
        />
      ) : !(isHovering && videoReady) || hasError || reducedMotion ? (
        <div className="absolute inset-0 z-[2] skeleton-shimmer" />
      ) : null}

      <video
        ref={videoRef}
        preload="none"
        loop
        muted
        playsInline
        aria-label={alt ? `${alt} video` : "Video preview"}
        onError={handleError}
        className={cn(
          "absolute inset-0 z-[3] h-full w-full transition-opacity duration-300",
          usesSmartFit ? foregroundMediaClassName : animatedMediaClassName,
          "focal-position-object",
          focalPositionClassName,
          hasError || reducedMotion || !videoReady || !isHovering ? "opacity-0" : "opacity-100"
        )}
        data-media-fit={usesSmartFit ? "smart" : "cover"}
        draggable={disableNativeDrag ? false : undefined}
        onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
      />

      <MuteButton videoRef={videoRef} showMuteControl={showMuteControl} />

      {/* YouTube-style red progress bar during hover playback */}
      {isHovering && videoReady && !hasError && !reducedMotion ? (
        <div className="absolute bottom-0 left-0 z-[9] h-[3px] w-full bg-white/20">
          <div
            className={cn(
              "h-full bg-red-600 transition-[width] duration-200 ease-linear",
              getProgressWidthClassName(hoverProgress)
            )}
          />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Feed tap indicator (YouTube-style fade-out icon)                    */
/* ------------------------------------------------------------------ */

function FeedTapIndicator({ action }: { action: "play" | "pause" }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 800);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[12] flex items-center justify-center animate-feed-tap-indicator"
      aria-hidden="true"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-md">
        {action === "play" ? (
          <Play className="h-6 w-6 fill-white pl-0.5" />
        ) : (
          <Pause className="h-6 w-6 fill-white" />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile feed video player (tap-to-toggle, scroll auto-play)         */
/* ------------------------------------------------------------------ */

interface FeedVideoPlayerProps {
  normalizedSrc?: string;
  normalizedPoster?: string;
  alt: string;
  sizes: string;
  className?: string;
  mediaClassName?: string;
  hoverScale: boolean;
  mediaFitClassName: string;
  priority: boolean;
  fitStrategy: MediaFitStrategy;
  containerAspectRatio: number;
  muteControlVisibility: MuteControlVisibility;
  focalX?: number | null;
  focalY?: number | null;
  onEnded?: () => void;
  feedPlaybackActive: boolean;
  disableNativeDrag: boolean;
}

function FeedVideoPlayer({
  normalizedSrc,
  normalizedPoster,
  alt,
  sizes,
  className,
  mediaClassName,
  hoverScale: _hoverScale,
  mediaFitClassName,
  priority,
  fitStrategy,
  containerAspectRatio,
  muteControlVisibility,
  focalX,
  focalY,
  onEnded,
  feedPlaybackActive,
  disableNativeDrag,
}: FeedVideoPlayerProps) {
  const posterNeedsUnoptimized =
    normalizedPoster?.startsWith("blob:") || normalizedPoster?.startsWith("data:");

  const { videoRef, isPlaying, togglePlayback, reducedMotion } = useVideoFeed(
    normalizedSrc,
    feedPlaybackActive
  );
  const [videoReady, setVideoReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | null>(null);
  const [tapIndicator, setTapIndicator] = useState<{
    key: number;
    action: "play" | "pause";
  } | null>(null);
  const tapKeyRef = useRef(0);

  const usesSmartFit = shouldUseSmartFit(fitStrategy, mediaAspectRatio, containerAspectRatio);
  const focalPositionClassName = !usesSmartFit
    ? getFocalPositionClassName(focalX, focalY)
    : undefined;
  const backgroundMediaSrc = normalizedPoster || normalizedSrc;
  const foregroundMediaClassName = getForegroundMediaClassName(
    mediaFitClassName,
    usesSmartFit,
    mediaClassName
  );
  const showMuteControl =
    muteControlVisibility !== "hidden" &&
    !hasError &&
    !reducedMotion &&
    muteControlVisibility === "always";

  // Show poster when video is not actively playing (includes user pause AND manager arbitration)
  const showPoster = !isPlaying || !videoReady || hasError;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onPlaying = () => setVideoReady(true);
    const onLoadedMetadata = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        setMediaAspectRatio(el.videoWidth / el.videoHeight);
      }
    };

    const onEndedNative = () => onEnded?.();

    el.addEventListener("playing", onPlaying);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("ended", onEndedNative);
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("ended", onEndedNative);
    };
  }, [videoRef, onEnded]);

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  const handlePosterError = useCallback(() => {
    setPosterError(true);
  }, []);

  const handleNativeDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (disableNativeDrag) {
        event.preventDefault();
      }
    },
    [disableNativeDrag]
  );

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setMediaAspectRatio(image.naturalWidth / image.naturalHeight);
    }
  }, []);

  const handleTap = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (hasError) return;

      const willPause = isPlaying;
      togglePlayback();

      tapKeyRef.current += 1;
      setTapIndicator({
        key: tapKeyRef.current,
        action: willPause ? "pause" : "play",
      });
    },
    [isPlaying, togglePlayback, hasError]
  );

  if (!normalizedSrc) {
    if (!normalizedPoster || posterError) {
      return <div className="absolute inset-0 skeleton-shimmer" />;
    }

    return (
      <Image
        src={normalizedPoster}
        alt={alt}
        fill
        className={cn(
          getForegroundMediaClassName(mediaFitClassName, usesSmartFit, mediaClassName),
          "focal-position-object",
          focalPositionClassName
        )}
        sizes={sizes}
        priority={priority}
        onLoad={handleImageLoad}
        onError={handlePosterError}
        data-media-fit={usesSmartFit ? "smart" : "cover"}
        unoptimized={posterNeedsUnoptimized ? true : undefined}
        draggable={disableNativeDrag ? false : undefined}
        onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
      />
    );
  }

  return (
    <div
      className={cn("relative h-full w-full", className)}
      data-media-fit={usesSmartFit ? "smart" : "cover"}
    >
      {usesSmartFit ? (
        <SmartFitBackdrop src={backgroundMediaSrc} sizes={sizes} priority={priority} />
      ) : null}

      {/* Poster / thumbnail — shown when paused-by-user or video not ready */}
      {normalizedPoster && !posterError ? (
        <Image
          src={normalizedPoster}
          alt={alt || "Video cover"}
          fill
          className={cn(
            "absolute inset-0 z-[2] transition-opacity duration-300",
            foregroundMediaClassName,
            "focal-position-object",
            focalPositionClassName,
            showPoster ? "opacity-100" : "opacity-0"
          )}
          sizes={sizes}
          priority={priority}
          onLoad={handleImageLoad}
          onError={handlePosterError}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
          unoptimized={posterNeedsUnoptimized ? true : undefined}
          draggable={disableNativeDrag ? false : undefined}
          onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
        />
      ) : showPoster ? (
        <div className="absolute inset-0 z-[2] skeleton-shimmer" />
      ) : null}

      {/* Video element */}
      <video
        ref={videoRef}
        preload="none"
        loop={!onEnded}
        muted
        playsInline
        aria-label={alt ? `${alt} video` : "Video preview"}
        onError={handleError}
        className={cn(
          "absolute inset-0 z-[3] h-full w-full transition-opacity duration-300",
          foregroundMediaClassName,
          "focal-position-object",
          focalPositionClassName,
          hasError || !videoReady ? "opacity-0" : "opacity-100"
        )}
        data-media-fit={usesSmartFit ? "smart" : "cover"}
        draggable={disableNativeDrag ? false : undefined}
        onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
      />

      {/* Transparent tap overlay — intercepts taps to toggle playback,
          prevents parent <Link> from navigating */}
      {!hasError && !reducedMotion ? (
        <div
          role="button"
          tabIndex={0}
          className="absolute inset-0 z-[10] cursor-pointer"
          onClick={handleTap}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleTap(e as unknown as React.MouseEvent);
            }
          }}
          aria-label={isPlaying ? "Pause video" : "Play video"}
        />
      ) : null}

      {/* Centered play button overlay — shown when video is paused/not playing (YouTube mobile style) */}
      {!hasError && !reducedMotion && !isPlaying ? (
        <div
          className="pointer-events-none absolute inset-0 z-[11] flex items-center justify-center"
          aria-hidden="true"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm">
            <Play className="h-6 w-6 fill-white pl-0.5" />
          </div>
        </div>
      ) : null}

      {/* Reduced motion: show play button, tap to start */}
      {reducedMotion && !hasError ? (
        <div
          role="button"
          tabIndex={0}
          className="absolute inset-0 z-[10] flex cursor-pointer items-center justify-center"
          onClick={handleTap}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleTap(e as unknown as React.MouseEvent);
            }
          }}
          aria-label="Play video"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-sm">
            <Play className="h-5 w-5 fill-white" />
          </div>
        </div>
      ) : null}

      {/* Tap indicator — YouTube-style fade-out circle */}
      {tapIndicator ? (
        <FeedTapIndicator key={tapIndicator.key} action={tapIndicator.action} />
      ) : null}

      <MuteButton videoRef={videoRef} showMuteControl={showMuteControl} />
    </div>
  );
}
