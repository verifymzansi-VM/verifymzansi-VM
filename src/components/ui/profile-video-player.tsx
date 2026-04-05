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

interface ProfileVideoPlayerProps {
  src: string;
  title: string;
  poster?: string;
  className?: string;
  videoClassName?: string;
  autoPlay?: boolean;
  loop?: boolean;
  onError?: () => void;
  skipSeconds?: number;
  showErrorState?: boolean;
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

    const { isMuted, toggleMute, setMuted } = useGlobalMute(localVideoRef);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [errorSource, setErrorSource] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const videoError = showErrorState && errorSource === src;

    useEffect(() => {
      const video = localVideoRef.current;
      if (!video) return;
      video.volume = volume;
    }, [volume]);

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
        video.play().catch(() => {});
        return;
      }
      video.pause();
    }, []);

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
                className="object-cover opacity-40"
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
            autoPlay={autoPlay}
            muted
            loop={loop}
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleLoadedMetadata}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={handleVideoError}
            className={cn("absolute inset-0 h-full w-full object-cover bg-black", videoClassName)}
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
            />

            <div className="flex items-center justify-between gap-2 text-white">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => skipBy(-skipSeconds)}
                  className="rounded-full p-2.5 transition-colors hover:bg-white/20 sm:p-2"
                  aria-label={`Rewind ${skipSeconds} seconds`}
                >
                  <SkipBack className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={togglePlay}
                  className="rounded-full p-2.5 transition-colors hover:bg-white/20 sm:p-2"
                  aria-label={isPlaying ? "Pause" : "Play"}
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
                  className="rounded-full p-2.5 transition-colors hover:bg-white/20 sm:p-2"
                  aria-label={`Forward ${skipSeconds} seconds`}
                >
                  <SkipForward className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={toggleMute}
                  className="rounded-full p-2.5 transition-colors hover:bg-white/20 sm:p-2"
                  aria-label={isMuted ? "Unmute" : "Mute"}
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
                  className="hidden h-1.5 w-20 cursor-pointer accent-white sm:block"
                  aria-label="Volume"
                />
                <span className="text-xs tabular-nums text-white/90 sm:text-sm">
                  {formatSeconds(currentTime)} / {formatSeconds(duration)}
                </span>
              </div>

              <button
                type="button"
                onClick={enterFullscreen}
                className="rounded-full p-2.5 transition-colors hover:bg-white/20 sm:p-2"
                aria-label="Fullscreen"
              >
                <Maximize2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
);
