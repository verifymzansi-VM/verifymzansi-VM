"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AlertTriangle, Maximize2, Play, RotateCcw } from "lucide-react";
import Image from "next/image";
import { VideoProgressLine } from "@/components/ui/video-seek-bar";
import { VideoSoundButton } from "@/components/ui/video-sound-button";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { useGlobalMute } from "@/hooks/use-global-mute";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useDataSaver } from "@/hooks/use-data-saver";

interface ProfileVideoPlayerProps {
  src: string;
  title: string;
  poster?: string;
  prioritizePoster?: boolean;
  posterSizes?: string;
  autoPlayOnMobile?: boolean;
  className?: string;
  videoClassName?: string;
  mediaFit?: "contain" | "cover";
  autoPlay?: boolean;
  loop?: boolean;
  onError?: () => void;
  skipSeconds?: number;
  showErrorState?: boolean;
  /** Called when playback reaches the end (only fires when `loop` is off). */
  onEnded?: () => void;
}

function getMediaFitClassName(mediaFit: "contain" | "cover") {
  return mediaFit === "contain" ? "object-contain" : "object-cover";
}

export const ProfileVideoPlayer = forwardRef<HTMLVideoElement, ProfileVideoPlayerProps>(
  function ProfileVideoPlayer(
    {
      src,
      title,
      poster,
      prioritizePoster = false,
      posterSizes = "100vw",
      autoPlayOnMobile = true,
      className,
      videoClassName,
      mediaFit = "contain",
      autoPlay = true,
      loop = true,
      onError,
      skipSeconds = 10,
      showErrorState = false,
      onEnded,
    },
    forwardedRef
  ) {
    const localVideoRef = useRef<HTMLVideoElement>(null);
    useImperativeHandle(forwardedRef, () => localVideoRef.current as HTMLVideoElement, []);

    const manager = useVideoPlaybackManager();
    const containerRef = useRef<HTMLDivElement>(null);
    const isPausedByUserRef = useRef(
      !autoPlay ||
        (!autoPlayOnMobile &&
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(max-width: 767px)").matches)
    );
    const reducedMotion = useReducedMotion();
    const dataSaver = useDataSaver();
    const autoplayBlocked = reducedMotion || dataSaver;

    const { isMuted, toggleMute } = useGlobalMute(localVideoRef);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [errorSource, setErrorSource] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [fullscreenError, setFullscreenError] = useState(false);
    const videoError = showErrorState && errorSource === src;
    const mediaFitClassName = getMediaFitClassName(mediaFit);
    const nativePoster = poster ? normalizeMediaUrl(poster) : undefined;

    /* ---- Register with global playback manager ---- */
    useEffect(() => {
      const video = localVideoRef.current;
      const container = containerRef.current;
      if (!video || !container) return;

      manager.register(video);

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (isPausedByUserRef.current || autoplayBlocked) {
            manager.updateVisibility(video, 0);
            return;
          }
          manager.updateVisibility(video, entry.intersectionRatio);
        },
        { threshold: [0, 0.25, 0.5, 0.75, 1] }
      );

      observer.observe(container);

      return () => {
        observer.disconnect();
        manager.unregister(video);
      };
    }, [manager, retryKey, autoplayBlocked]);

    const handleLoadedMetadata = useCallback(() => {
      const video = localVideoRef.current;
      if (!video) return;
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    }, []);

    // The video can read its length before this page is interactive, and then its
    // loadedmetadata event has already passed: read the length once on mount.
    useEffect(() => {
      if ((localVideoRef.current?.readyState ?? 0) >= 1) handleLoadedMetadata();
    }, [handleLoadedMetadata, retryKey]);

    const handleTimeUpdate = useCallback(() => {
      const video = localVideoRef.current;
      if (!video) return;
      setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    }, []);

    const togglePlay = useCallback(() => {
      const video = localVideoRef.current;
      if (!video) return;
      if (video.paused) {
        isPausedByUserRef.current = false;
        if (video.ended && Number.isFinite(video.duration)) {
          video.currentTime = 0;
          setCurrentTime(0);
        }
        manager.requestPriority(video);
        video.play().catch(() => {
          /* Browser autoplay policy can still reject; keep the visible play affordance. */
        });
        return;
      }
      isPausedByUserRef.current = true;
      video.pause();
      manager.updateVisibility(video, 0);
      manager.releasePriority(video);
    }, [manager]);

    const seekTo = useCallback((time: number) => {
      const video = localVideoRef.current;
      if (!video) return;
      const maxTime = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const next = Math.min(Math.max(time, 0), maxTime || Math.max(time, 0));
      video.currentTime = next;
      setCurrentTime(next);
    }, []);

    const skipBy = useCallback(
      (delta: number) => {
        const video = localVideoRef.current;
        if (!video) return;
        seekTo(video.currentTime + delta);
      },
      [seekTo]
    );

    const enterFullscreen = useCallback(async () => {
      const video = localVideoRef.current;
      if (!video) return;
      setFullscreenError(false);
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        } else if (
          (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen
        ) {
          (
            video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
          ).webkitEnterFullscreen?.();
        } else setFullscreenError(true);
      } catch {
        setFullscreenError(true);
      }
    }, []);

    const handleVideoError = useCallback(() => {
      onError?.();
      if (showErrorState) {
        setErrorSource(src);
      }
    }, [onError, showErrorState, src]);

    const handleRetry = useCallback(() => {
      setErrorSource(null);
      setRetryKey((current) => current + 1);
    }, []);

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
        if (
          event.target instanceof Element &&
          event.target.closest("input, button, a, select, textarea, [contenteditable]")
        ) {
          return;
        }

        switch (event.key.toLowerCase()) {
          case " ":
          case "k":
            event.preventDefault();
            togglePlay();
            break;
          case "j":
            event.preventDefault();
            skipBy(-skipSeconds);
            break;
          case "l":
            event.preventDefault();
            skipBy(skipSeconds);
            break;
          case "arrowleft":
            event.preventDefault();
            skipBy(-5);
            break;
          case "arrowright":
            event.preventDefault();
            skipBy(5);
            break;
          case "m":
            event.preventDefault();
            toggleMute();
            break;
          case "f":
            event.preventDefault();
            enterFullscreen();
            break;
          default:
            break;
        }
      },
      [enterFullscreen, skipBy, skipSeconds, toggleMute, togglePlay]
    );

    return (
      <div
        ref={containerRef}
        className={cn("absolute inset-0 bg-black", className)}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={`${title} video player`}
      >
        {fullscreenError ? (
          <p
            role="status"
            className="absolute inset-x-4 top-14 z-30 rounded-lg bg-black/80 p-2 text-center text-xs text-white"
          >
            Fullscreen is unavailable. You can keep watching here.
          </p>
        ) : null}
        {videoError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            {poster ? (
              <Image
                src={poster}
                alt={`${title} poster`}
                fill
                className={cn(mediaFitClassName, "opacity-40")}
                sizes={posterSizes}
              />
            ) : null}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 backdrop-blur-sm">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <span className="text-xs font-medium text-white/90">Video failed to load</span>
              <button
                type="button"
                onClick={handleRetry}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white shadow-lg transition-transform hover:scale-110"
                aria-label="Retry video"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <>
            {poster && mediaFit === "contain" ? (
              <>
                <Image
                  src={poster}
                  alt=""
                  aria-hidden="true"
                  fill
                  // Blur backdrop is desktop-only: full-width Gaussian blur is a
                  // severe mobile GPU cost (see video-card-player SmartFitBackdrop).
                  className="absolute inset-0 scale-110 object-cover opacity-75 blur-none brightness-100 md:blur-2xl md:brightness-75 md:motion-reduce:blur-none"
                  sizes={posterSizes}
                  loading={prioritizePoster ? "eager" : "lazy"}
                  fetchPriority={prioritizePoster ? "high" : "auto"}
                />
                <div className="absolute inset-0 bg-black/35" aria-hidden="true" />
              </>
            ) : null}
            <video
              key={retryKey}
              ref={localVideoRef}
              src={src}
              poster={nativePoster}
              preload={autoPlayOnMobile ? "metadata" : "none"}
              muted
              loop={loop}
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={onEnded}
              onError={handleVideoError}
              // Tapping the picture pauses; while paused the play overlay covers it.
              onClick={togglePlay}
              className={cn(
                "absolute inset-0 h-full w-full cursor-pointer",
                mediaFitClassName,
                videoClassName
              )}
              aria-label={`${title} video`}
            >
              <track kind="captions" />
            </video>
          </>
        )}

        {/* Tap the picture to play; while paused a quiet play icon stays in the centre. */}
        {!videoError && !isPlaying && (
          <button
            type="button"
            onClick={togglePlay}
            className="absolute inset-0 z-10 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gold-300"
            aria-label="Play video"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45">
              <Play className="h-7 w-7 translate-x-0.5 fill-white text-white" aria-hidden="true" />
            </span>
          </button>
        )}

        {/* Only what controls the picture: sound (top centre), full screen and the thin line. */}
        {!videoError && (
          <>
            <VideoSoundButton muted={isMuted} onToggle={toggleMute} />
            <button
              type="button"
              onClick={enterFullscreen}
              className="absolute right-1 top-1 z-20 flex h-11 w-11 items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
              aria-label="Fullscreen"
              data-carousel-control="true"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green-950/75 ring-1 ring-white/20">
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </span>
            </button>
            <VideoProgressLine
              currentTime={currentTime}
              duration={duration}
              onSeek={seekTo}
              className="absolute inset-x-0 bottom-0 z-20"
            />
          </>
        )}
      </div>
    );
  }
);
