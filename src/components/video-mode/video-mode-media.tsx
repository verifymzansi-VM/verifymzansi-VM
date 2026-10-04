"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { BrandShield } from "@/components/shared/brand-shield";
import { VideoViewTracker } from "@/components/ui/video-view-tracker";
import type { FeedMediaItem, FeedSlide } from "@/lib/feed/types";
import { cn } from "@/lib/utils";

const RESUME_KEY = "vm:video:resume";

interface ResumePoint {
  post: string;
  media: number;
  time: number;
}

/** Where the last video stopped, so Back from a post's details continues it. */
function readResume(): ResumePoint | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(RESUME_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object") return null;
    const { post, media, time } = value as Record<string, unknown>;
    return typeof post === "string" && typeof media === "number" && typeof time === "number"
      ? { post, media, time }
      : null;
  } catch {
    return null;
  }
}

function writeResume(point: ResumePoint) {
  try {
    window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(point));
  } catch {
    // Blocked storage: the video simply starts from the beginning next time.
  }
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

/** Data saver or a 2G connection: nothing plays until the visitor asks. ("3g" is common on usable SA connections.) */
export function useConstrainedNetwork(): boolean {
  const [constrained, setConstrained] = useState(false);
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike })
      .connection;
    if (!connection) return;
    const update = () =>
      setConstrained(
        Boolean(connection.saveData) || ["slow-2g", "2g"].includes(connection.effectiveType ?? "")
      );
    update();
    connection.addEventListener?.("change", update);
    return () => connection.removeEventListener?.("change", update);
  }, []);
  return constrained;
}

/** Still image for a media item: the photo, or a video's poster. */
function stillOf(item: FeedMediaItem | undefined) {
  if (!item) return null;
  return item.kind === "photo" ? item.url : (item.poster ?? null);
}

function Still({ src, alt, priority }: { src: string; alt: string; priority: boolean }) {
  return (
    <>
      {/* The same image, blurred and tiny, fills the space around a picture of another shape. */}
      <Image
        src={src}
        alt=""
        fill
        sizes="96px"
        className="scale-110 object-cover opacity-40 blur-2xl"
        aria-hidden="true"
      />
      <Image
        src={src}
        alt={alt}
        fill
        sizes="100vw"
        priority={priority}
        className="object-contain"
      />
    </>
  );
}

function Fallback({ slide }: { slide: FeedSlide }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-brand-green-950 px-10 text-center">
      <div className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.09] invert" />
      <BrandShield className="relative h-12 w-12 text-brand-gold-300" aria-hidden="true" />
      <p className="relative text-sm text-white/70">{slide.title}</p>
    </div>
  );
}

/**
 * One post's media, filling the screen with its whole picture visible. Only
 * the post on screen mounts a <video>; the others show a still, so the phone
 * holds one decoder and downloads one video at a time.
 */
export function VideoModeMedia({
  slide,
  active,
  mediaIndex,
  muted,
  held,
  constrained,
  analytics,
  ignoreTap,
  onVideoViewRecorded,
  onPlayingChange,
  onUserPause,
  onSoundBlocked,
}: {
  slide: FeedSlide;
  active: boolean;
  mediaIndex: number;
  muted: boolean;
  /** A sheet, dialog or hidden tab: playback waits. */
  held: boolean;
  /** Data saver or a slow connection. */
  constrained: boolean;
  analytics: boolean;
  /** True right after a swipe, so the finger lifting is not taken as a tap. */
  ignoreTap: () => boolean;
  onVideoViewRecorded: () => void;
  /** The video on screen started or stopped (clean view hides the controls only while playing). */
  onPlayingChange: (playing: boolean) => void;
  /** The visitor paused to look: the post's details come back. */
  onUserPause: () => void;
  /** The browser refused sound without a fresh tap; playback carried on muted. */
  onSoundBlocked: () => void;
}) {
  const index = Math.min(mediaIndex, Math.max(0, slide.media.length - 1));
  const item = slide.media[index];
  const still = stillOf(item);
  const alt =
    slide.media.length > 1 ? `${slide.title}, ${index + 1} of ${slide.media.length}` : slide.title;

  if (!item) return <Fallback slide={slide} />;
  if (item.kind === "photo" || !active) {
    return (
      <div className="absolute inset-0 bg-black">
        {still ? <Still src={still} alt={alt} priority={active} /> : <Fallback slide={slide} />}
        {item.kind === "video" ? (
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <Play className="h-14 w-14 fill-white/80 text-white/80 drop-shadow" />
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <VideoViewTracker
      targetId={slide.id}
      targetType={slide.targetType}
      surface={`video:${slide.vertical}`}
      enabled={analytics}
      onRecorded={onVideoViewRecorded}
    >
      <ActiveVideo
        key={`${slide.key}:${index}`}
        slide={slide}
        item={item}
        index={index}
        muted={muted}
        held={held}
        constrained={constrained}
        ignoreTap={ignoreTap}
        onPlayingChange={onPlayingChange}
        onUserPause={onUserPause}
        onSoundBlocked={onSoundBlocked}
      />
    </VideoViewTracker>
  );
}

function ActiveVideo({
  slide,
  item,
  index,
  muted,
  held,
  constrained,
  ignoreTap,
  onPlayingChange,
  onUserPause,
  onSoundBlocked,
}: {
  slide: FeedSlide;
  item: FeedMediaItem;
  index: number;
  muted: boolean;
  held: boolean;
  constrained: boolean;
  ignoreTap: () => boolean;
  onPlayingChange: (playing: boolean) => void;
  onUserPause: () => void;
  onSoundBlocked: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // The latest callbacks, so new ones never restart playback.
  const report = useRef({ onPlayingChange, onSoundBlocked });
  useEffect(() => {
    report.current = { onPlayingChange, onSoundBlocked };
  });
  // Paused by the visitor; blocked by the browser; waiting for a tap on slow data.
  const [paused, setPaused] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const waitsForTap = constrained && !started;
  const shouldPlay = !held && !paused && !waitsForTap && !failed;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!shouldPlay) {
      video.pause();
      return;
    }
    let cancelled = false;
    const notAllowed = (error: unknown) =>
      error instanceof DOMException && error.name === "NotAllowedError";
    video
      .play()
      .then(() => {
        if (!cancelled) setBlocked(false);
      })
      .catch((error: unknown) => {
        // AbortError: a pause won the race. NotAllowedError: the browser wants a tap first.
        if (cancelled || !notAllowed(error)) return;
        if (!video.muted) {
          // Sound needs a fresh tap on some phones (iOS): keep going muted rather than stopping.
          video.muted = true;
          report.current.onSoundBlocked();
          video.play().catch((retry: unknown) => {
            if (!cancelled && notAllowed(retry)) setBlocked(true);
          });
          return;
        }
        setBlocked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldPlay, attempt]);

  // Report playing and paused (whatever the cause) so the viewer knows when to keep things clean.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => report.current.onPlayingChange(!video.paused);
    video.addEventListener("play", update);
    video.addEventListener("pause", update);
    return () => {
      video.removeEventListener("play", update);
      video.removeEventListener("pause", update);
      report.current.onPlayingChange(false);
    };
  }, [attempt]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Remember the position whenever playback stops (sheet, details, swipe away).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const save = () => {
      if (video.currentTime > 0.5) {
        writeResume({ post: slide.id, media: index, time: video.currentTime });
      }
    };
    video.addEventListener("pause", save);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      video.removeEventListener("pause", save);
      window.removeEventListener("pagehide", save);
    };
  }, [slide.id, index]);

  // A slow connection shows a spinner only when waiting is noticeable.
  const bufferTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (bufferTimer.current) window.clearTimeout(bufferTimer.current);
    },
    []
  );
  const onWaiting = () => {
    if (bufferTimer.current) window.clearTimeout(bufferTimer.current);
    bufferTimer.current = window.setTimeout(() => setBuffering(true), 400);
  };
  const onPlaying = () => {
    if (bufferTimer.current) window.clearTimeout(bufferTimer.current);
    setBuffering(false);
  };

  function toggle() {
    if (ignoreTap()) return;
    if (failed) return;
    if (waitsForTap || blocked) {
      setStarted(true);
      setPaused(false);
      setBlocked(false);
      // Called inside the tap so the browser accepts it as the visitor's choice.
      void videoRef.current?.play().catch(() => setBlocked(true));
      return;
    }
    if (!paused) onUserPause();
    setPaused(!paused);
  }

  const showPlay = !failed && (paused || blocked || waitsForTap);

  return (
    <div className="absolute inset-0 bg-black">
      {item.poster ? <Still src={item.poster} alt="" priority /> : null}
      <video
        key={attempt}
        ref={videoRef}
        src={item.url}
        poster={item.poster}
        className="absolute inset-0 h-full w-full object-contain"
        data-vm-active-video
        playsInline
        muted={muted}
        loop
        preload={constrained ? "none" : "auto"}
        disablePictureInPicture
        disableRemotePlayback
        aria-label={`${slide.title} video`}
        onLoadedMetadata={(event) => {
          const resume = readResume();
          const video = event.currentTarget;
          if (
            resume &&
            resume.post === slide.id &&
            resume.media === index &&
            resume.time < video.duration - 1
          ) {
            video.currentTime = resume.time;
          }
        }}
        onWaiting={onWaiting}
        onPlaying={onPlaying}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={toggle}
        className="absolute inset-0 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-gold-300"
        aria-label={showPlay ? "Play video" : "Pause video"}
        aria-pressed={!showPlay}
      >
        {showPlay ? (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45">
            <Play className="h-8 w-8 translate-x-0.5 fill-white text-white" aria-hidden="true" />
          </span>
        ) : buffering ? (
          <Loader2 className="h-10 w-10 animate-spin text-white/80" aria-hidden="true" />
        ) : null}
      </button>
      {failed ? (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 px-10 text-center">
          <p className="rounded-xl bg-black/60 px-4 py-2 text-sm text-white">
            This video could not play.
          </p>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
            className={cn(
              "flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-brand-green-950",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
            )}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
