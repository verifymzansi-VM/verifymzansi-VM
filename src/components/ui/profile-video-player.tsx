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
import {
  AlertTriangle,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useGlobalMute } from "@/hooks/use-global-mute";
import { useVideoPlaybackManager } from "@/contexts/video-playback-context";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

interface ProfileVideoPlayerProps {
  src: string;
  title: string;
  poster?: string;
  className?: string;
  videoClassName?: string;
  mediaFit?: "contain" | "cover";
  autoPlay?: boolean;
  loop?: boolean;
  onError?: () => void;
  skipSeconds?: number;
  showErrorState?: boolean;
}

function getMediaFitClassName(mediaFit: "contain" | "cover") {
  return mediaFit === "contain" ? "object-contain bg-black" : "object-cover";
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export const ProfileVideoPlayer = forwardRef<HTMLVideoElement, ProfileVideoPlayerProps>(
  function ProfileVideoPlayer(
    {
      src,
      title,
      poster,
      className,
      videoClassName,
      mediaFit = "contain",
      autoPlay = true,
      loop = true,
      onError,
      skipSeconds = 10,
      showErrorState = false,
    },
    forwardedRef
  ) {
    const localVideoRef = useRef<HTMLVideoElement>(null);
    useImperativeHandle(forwardedRef, () => localVideoRef.current as HTMLVideoElement, []);

    const manager = useVideoPlaybackManager();
    const containerRef = useRef<HTMLDivElement>(null);
    const isPausedByUserRef = useRef(!autoPlay);
    const reducedMotion = useReducedMotion();

    const { isMuted, toggleMute, setMuted } = useGlobalMute(localVideoRef);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [errorSource, setErrorSource] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [isCompactLayout, setIsCompactLayout] = useState(false);
    const videoError = showErrorState && errorSource === src;
    const mediaFitClassName = getMediaFitClassName(mediaFit);

    useEffect(() => {
      const video = localVideoRef.current;
      if (!video) return;
      video.volume = volume;
    }, [volume]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || typeof ResizeObserver === "undefined") {
        return;
      }

      const observer = new ResizeObserver(([entry]) => {
        const width = entry?.contentRect.width ?? 0;
        setIsCompactLayout(width > 0 && width < 360);
      });

      observer.observe(container);

      return () => observer.disconnect();
    }, []);

    /* ---- Register with global playback manager ---- */
    useEffect(() => {
      const video = localVideoRef.current;
      const container = containerRef.current;
      if (!video || !container) return;

      manager.register(video);

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (isPausedByUserRef.current || reducedMotion) {
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
    }, [manager, retryKey, reducedMotion]);

    const handleLoadedMetadata = useCallback(() => {
      const video = localVideoRef.current;
      if (!video) return;
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    }, []);

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
        manager.requestPriority(video);
        return;
      }
      isPausedByUserRef.current = true;
      video.pause();
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

    const enterFullscreen = useCallback(() => {
      const video = localVideoRef.current;
      if (!video) return;
      try {
        if (video.requestFullscreen) {
          video.requestFullscreen();
        } else if (
          (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen
        ) {
          (
            video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
          ).webkitEnterFullscreen?.();
        }
      } catch {
        /* fullscreen not supported */
      }
    }, []);

    const onVolumeInput = useCallback(
      (next: number) => {
        const normalized = Math.min(Math.max(next, 0), 1);
        setVolume(normalized);
        setMuted(normalized === 0);
      },
      [setMuted]
    );

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
        if (event.target instanceof HTMLInputElement) {
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
        className={cn("absolute inset-0", className)}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={`${title} video player`}
      >
        {videoError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            {poster ? (
              <Image
                src={poster}
                alt={`${title} poster`}
                fill
                className={cn(mediaFitClassName, "opacity-40")}
                sizes="100vw"
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
          <video
            key={retryKey}
            ref={localVideoRef}
            src={src}
            poster={poster}
            muted
            loop={loop}
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={handleVideoError}
            className={cn("absolute inset-0 h-full w-full", mediaFitClassName, videoClassName)}
            aria-label={`${title} video`}
          >
            <track kind="captions" />
          </video>
        )}

        {!videoError && !isPlaying && (
          <button
            type="button"
            onClick={togglePlay}
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/25"
            aria-label="Play video"
          >
            <div className="rounded-full bg-white/90 p-4 shadow-xl backdrop-blur-sm">
              <Play className="h-8 w-8 fill-black text-black" />
            </div>
          </button>
        )}

        {!videoError && (
          <>
            <button
              type="button"
              onClick={enterFullscreen}
              className="absolute right-3 top-3 z-20 rounded-full bg-black/45 p-2 text-white/95 backdrop-blur-sm transition-colors hover:bg-black/65"
              aria-label="Fullscreen"
              data-carousel-control="true"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 sm:p-4">
              <input
                type="range"
                min={0}
                max={Math.max(duration, 0)}
                step={0.1}
                value={Math.min(currentTime, duration || currentTime)}
                onChange={(event) => seekTo(Number(event.target.value))}
                className="mb-2 h-1.5 w-full cursor-pointer accent-brand-red"
                aria-label="Seek playback"
                data-carousel-control="true"
              />

              <div className="flex items-center justify-between gap-2 text-white">
                <div
                  className={cn(
                    "flex min-w-0 items-center text-white",
                    isCompactLayout ? "gap-1" : "gap-1.5 sm:gap-2"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => skipBy(-skipSeconds)}
                    className={cn(
                      "rounded-full transition-colors hover:bg-white/20",
                      isCompactLayout ? "p-2" : "p-2.5 sm:p-2"
                    )}
                    aria-label={`Rewind ${skipSeconds} seconds`}
                    data-carousel-control="true"
                  >
                    <SkipBack className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    className={cn(
                      "rounded-full transition-colors hover:bg-white/20",
                      isCompactLayout ? "p-2" : "p-2.5 sm:p-2"
                    )}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    data-carousel-control="true"
                  >
                    {isPlaying ? (
                      <Pause className="h-5 w-5" />
                    ) : (
                      <Play className="h-5 w-5 fill-white" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => skipBy(skipSeconds)}
                    className={cn(
                      "rounded-full transition-colors hover:bg-white/20",
                      isCompactLayout ? "p-2" : "p-2.5 sm:p-2"
                    )}
                    aria-label={`Forward ${skipSeconds} seconds`}
                    data-carousel-control="true"
                  >
                    <SkipForward className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleMute}
                    className={cn(
                      "rounded-full transition-colors hover:bg-white/20",
                      isCompactLayout ? "p-2" : "p-2.5 sm:p-2"
                    )}
                    aria-label={isMuted ? "Unmute" : "Mute"}
                    data-carousel-control="true"
                  >
                    {isMuted ? (
                      <VolumeX className="h-5 w-5" />
                    ) : volume <= 0.5 ? (
                      <Volume1 className="h-5 w-5" />
                    ) : (
                      <Volume2 className="h-5 w-5" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(event) => onVolumeInput(Number(event.target.value))}
                    className={cn(
                      "hidden h-1.5 w-20 cursor-pointer accent-white",
                      !isCompactLayout && "sm:block"
                    )}
                    aria-label="Volume"
                    data-carousel-control="true"
                  />
                  <span
                    className={cn(
                      "truncate text-xs tabular-nums text-white/90",
                      isCompactLayout ? "max-w-[4.75rem]" : "sm:text-sm"
                    )}
                    data-carousel-control="true"
                  >
                    {formatSeconds(currentTime)} / {formatSeconds(duration)}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
);
