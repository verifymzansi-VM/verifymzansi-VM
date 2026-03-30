"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { Volume2, VolumeX, Maximize2, Play, Pause, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { useHoverCapability } from "@/hooks/use-hover-capability";
import { useVideoVisibility } from "@/hooks/use-video-visibility";
import { useVideoHover } from "@/hooks/use-video-hover";

const DEFAULT_MEDIA_FIT = "object-fill";
const DEFAULT_CONTAINER_ASPECT_RATIO = 5 / 4;

export type MediaFitStrategy = "cover" | "smart";
export type MuteControlVisibility = "auto" | "always" | "hidden";

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

function shouldUseSmartFit(
  _fitStrategy: MediaFitStrategy,
  _mediaAspectRatio: number | null,
  _containerAspectRatio: number
) {
  return false;
}

function getForegroundMediaClassName(
  baseFitClassName: string,
  usesSmartFit: boolean,
  mediaClassName?: string
) {
  return cn(
    usesSmartFit ? "object-contain" : baseFitClassName,
    usesSmartFit && "drop-shadow-[0_20px_50px_rgba(15,23,42,0.4)]",
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
  if (!src) {
    return (
      <>
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950" />
        <div className="absolute inset-0 bg-black/35" />
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
        className="absolute inset-0 scale-110 object-cover blur-2xl brightness-90 saturate-150"
        sizes={sizes}
        priority={priority}
      />
      <div className="absolute inset-0 bg-black/10" />
    </>
  );
}

function MuteButton({
  isMuted,
  onToggle,
}: {
  isMuted: boolean;
  onToggle: (event: React.SyntheticEvent) => void;
}) {
  return (
    <div className="absolute right-3 top-3 z-[8]">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/10 bg-black/55 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/70"
        aria-label={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
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
  /** Notifies callers when the ambient playback control changes state. */
  onPlaybackStateChange?: (isPlaying: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function VideoCardPlayer({
  src,
  posterUrl,
  alt = "Media",
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw",
  className,
  mediaClassName,
  hoverScale = true,
  mediaFitClassName = DEFAULT_MEDIA_FIT,
  mode = "interactive",
  priority = false,
  fitStrategy = "smart",
  containerAspectRatio = DEFAULT_CONTAINER_ASPECT_RATIO,
  muteControlVisibility = "auto",
  showPlaybackControl = false,
  onPlaybackStateChange,
}: VideoCardPlayerProps) {
  const isVideo = isVideoUrl(src);
  const normalizedSrc = src ? normalizeMediaUrl(src) : undefined;
  const normalizedPoster = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const canHover = useHoverCapability();
  const effectiveMode = mode === "hover" && !canHover ? "ambient" : mode;
  const mediaKey = `${normalizedSrc ?? "none"}|${normalizedPoster ?? "none"}|${effectiveMode}|${showPlaybackControl ? "controls" : "no-controls"}`;

  if (effectiveMode === "hover" && isVideo) {
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
      />
    );
  }

  return (
    <VideoCardPlayerInner
      key={mediaKey}
      isVideo={isVideo}
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
      onPlaybackStateChange={onPlaybackStateChange}
    />
  );
}

function getInitialAmbientPlaybackPaused(
  mode: "interactive" | "ambient",
  showPlaybackControl: boolean
) {
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
  onPlaybackStateChange?: (isPlaying: boolean) => void;
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
  canHover,
  fitStrategy,
  containerAspectRatio,
  muteControlVisibility,
  showPlaybackControl,
  onPlaybackStateChange,
}: VideoCardPlayerInnerProps) {
  const [isPlaybackPaused, setIsPlaybackPaused] = useState(() =>
    getInitialAmbientPlaybackPaused(mode, showPlaybackControl)
  );
  const [hasActivatedPlayback, setHasActivatedPlayback] = useState(false);
  const shouldAutoplay = !isPlaybackPaused;
  const { videoRef, reducedMotion } = useVideoVisibility(
    isVideo ? normalizedSrc : undefined,
    shouldAutoplay
  );
  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | null>(null);

  const usesSmartFit = shouldUseSmartFit(fitStrategy, mediaAspectRatio, containerAspectRatio);
  const backgroundMediaSrc = normalizedPoster || (isVideo ? undefined : normalizedSrc);
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
    const onPlay = () => setHasActivatedPlayback(true);
    const onLoadedMetadata = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        setMediaAspectRatio(el.videoWidth / el.videoHeight);
      }
    };

    el.addEventListener("playing", onPlaying);
    el.addEventListener("play", onPlay);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [videoRef]);

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setMediaAspectRatio(image.naturalWidth / image.naturalHeight);
    }
  }, []);

  const handleVideoClick = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!videoRef.current) return;

      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => {
          /* autoplay may still be blocked */
        });
      }

      videoRef.current.muted = false;
      setIsMuted(false);

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
      setIsMuted((current) => {
        const nextMuted = !current;
        if (videoRef.current) {
          videoRef.current.muted = nextMuted;
        }
        return nextMuted;
      });
    },
    [videoRef]
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
        el.play().catch(() => {
          /* autoplay may be blocked */
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
        el.play().catch(() => {
          /* autoplay may be blocked */
        });
      }
    },
    [videoRef, normalizedSrc]
  );

  if (!isVideo) {
    if (!normalizedSrc) return null;

    if (usesSmartFit) {
      return (
        <div
          className={cn("relative h-full w-full", className)}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
        >
          <SmartFitBackdrop src={backgroundMediaSrc} sizes={sizes} priority={priority} />
          <Image
            src={normalizedSrc}
            alt={alt}
            fill
            className={foregroundMediaClassName}
            sizes={sizes}
            priority={priority}
            onLoad={handleImageLoad}
            data-media-fit="smart"
          />
        </div>
      );
    }

    return (
      <Image
        src={normalizedSrc}
        alt={alt}
        fill
        className={animatedMediaClassName}
        sizes={sizes}
        priority={priority}
        onLoad={handleImageLoad}
        data-media-fit="cover"
      />
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

        {normalizedPoster ? (
          <Image
            src={normalizedPoster}
            alt={alt || "Video cover"}
            fill
            className={cn(
              "absolute inset-0 z-[2] transition-opacity duration-300",
              foregroundMediaClassName,
              videoReady && !hasError && canDisplayVideo ? "opacity-0" : "opacity-100"
            )}
            sizes={sizes}
            priority={priority}
            onLoad={handleImageLoad}
            data-media-fit={usesSmartFit ? "smart" : "cover"}
          />
        ) : !videoReady || hasError || reducedMotion ? (
          <div className="absolute inset-0 z-[2] bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800" />
        ) : null}

        <video
          ref={videoRef}
          preload="none"
          loop
          muted={isMuted}
          playsInline
          aria-label={alt ? `${alt} video` : "Video preview"}
          onError={handleError}
          className={cn(
            "relative z-[3] h-full w-full transition-opacity duration-300",
            foregroundMediaClassName,
            hasError || !videoReady || !canDisplayVideo ? "opacity-0" : "opacity-100"
          )}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
        />

        {showMuteControl ? <MuteButton isMuted={isMuted} onToggle={toggleMute} /> : null}
        {showPlaybackToggle ? (
          <div className="absolute bottom-3 left-3 z-[8]">
            <button
              type="button"
              onClick={togglePlayback}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/10 bg-black/55 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/70"
              aria-label={isPlaybackPaused ? "Play video" : "Pause video"}
            >
              {isPlaybackPaused ? (
                <Play className="h-4 w-4 fill-white" />
              ) : (
                <Pause className="h-4 w-4 fill-white" />
              )}
            </button>
          </div>
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

      {normalizedPoster ? (
        <Image
          src={normalizedPoster}
          alt={alt || "Video cover"}
          fill
          className={cn(
            "absolute inset-0 z-[2] transition-opacity duration-300",
            foregroundMediaClassName,
            videoReady && !hasError ? "opacity-0" : "opacity-100"
          )}
          sizes={sizes}
          priority={priority}
          onLoad={handleImageLoad}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
        />
      ) : !videoReady || hasError ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800">
          <Play className="h-10 w-10 text-white/60" />
        </div>
      ) : null}

      <video
        ref={videoRef}
        preload="none"
        loop
        muted={isMuted}
        playsInline
        aria-label={alt ? `${alt} video` : "Video preview"}
        onError={handleError}
        className={cn(
          "relative z-[3] h-full w-full transition-opacity duration-300",
          foregroundMediaClassName,
          !videoReady || hasError ? "opacity-0" : "opacity-100"
        )}
        data-media-fit={usesSmartFit ? "smart" : "cover"}
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

      {showMuteControl ? <MuteButton isMuted={isMuted} onToggle={toggleMute} /> : null}

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
        canHover ? (
          <div
            className="absolute inset-0 z-10 hidden cursor-pointer flex-col justify-between bg-black/18 p-2 opacity-0 transition-opacity duration-300 group-hover/video:flex group-hover/video:opacity-100"
            onClick={handleVideoClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleVideoClick(e as unknown as React.MouseEvent);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Toggle video playback"
          >
            <div />
            <div className="flex items-center justify-center flex-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-110">
                <Maximize2 className="h-5 w-5" />
              </div>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 z-10 flex flex-col justify-between bg-black/16 p-2">
            <div />
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
        )
      ) : null}

      {!hasError && !reducedMotion ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-[5] flex items-center justify-center transition-opacity duration-300",
            canHover ? "opacity-100 group-hover/video:opacity-0" : "opacity-100"
          )}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm">
            {canHover ? (
              <Play className="h-5 w-5 fill-white pr-0.5" />
            ) : (
              <Maximize2 className="h-5 w-5" />
            )}
          </div>
        </div>
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
}: HoverVideoPlayerProps) {
  const { videoRef, containerRef, reducedMotion, isHovering } = useVideoHover(normalizedSrc);
  const [videoReady, setVideoReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | null>(null);

  const usesSmartFit = shouldUseSmartFit(fitStrategy, mediaAspectRatio, containerAspectRatio);
  const backgroundMediaSrc = normalizedPoster; // Hover player implies it's a video
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

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setMediaAspectRatio(image.naturalWidth / image.naturalHeight);
    }
  }, []);

  const toggleMute = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsMuted((current) => {
        const nextMuted = !current;
        if (videoRef.current) {
          videoRef.current.muted = nextMuted;
        }
        return nextMuted;
      });
    },
    [videoRef]
  );

  if (!normalizedSrc) {
    if (!normalizedPoster) return null;

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
            data-media-fit="smart"
          />
        </div>
      );
    }

    return (
      <Image
        src={normalizedPoster}
        alt={alt}
        fill
        className={animatedMediaClassName}
        sizes={sizes}
        priority={priority}
        onLoad={handleImageLoad}
        data-media-fit="cover"
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

      {normalizedPoster ? (
        <Image
          src={normalizedPoster}
          alt={alt || "Video cover"}
          fill
          className={cn(
            "absolute inset-0 z-[2] transition-opacity duration-300",
            foregroundMediaClassName,
            isHovering && videoReady && !hasError && !reducedMotion ? "opacity-0" : "opacity-100"
          )}
          sizes={sizes}
          priority={priority}
          onLoad={handleImageLoad}
          data-media-fit={usesSmartFit ? "smart" : "cover"}
        />
      ) : !(isHovering && videoReady) || hasError || reducedMotion ? (
        <div className="absolute inset-0 z-[2] bg-gradient-to-br from-warm-200 to-warm-300 dark:from-warm-700 dark:to-warm-800" />
      ) : null}

      <video
        ref={videoRef}
        preload="none"
        loop
        muted={isMuted}
        playsInline
        aria-label={alt ? `${alt} video` : "Video preview"}
        onError={handleError}
        className={cn(
          "relative z-[3] h-full w-full transition-opacity duration-300",
          usesSmartFit ? foregroundMediaClassName : animatedMediaClassName,
          hasError || reducedMotion || !videoReady || !isHovering ? "opacity-0" : "opacity-100"
        )}
        data-media-fit={usesSmartFit ? "smart" : "cover"}
      />

      {showMuteControl ? <MuteButton isMuted={isMuted} onToggle={toggleMute} /> : null}
    </div>
  );
}
