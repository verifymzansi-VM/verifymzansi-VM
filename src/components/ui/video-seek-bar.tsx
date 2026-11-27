"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { describeVideoProgress } from "@/lib/media/video-time";
import { cn } from "@/lib/utils";

/** Height of the seek bar's touch and click area; the visible track stays thin (WCAG 2.5.8). */
export const SEEK_TARGET_PX = 24;
/** Movement before a touch picks an axis (the same rule as video mode's swipes). */
const SEEK_AXIS_LOCK_PX = 10;
/** How far one Left or Right arrow press moves playback. */
export const SEEK_KEY_STEP_SECONDS = 5;

const TARGET_STYLE: CSSProperties = { height: SEEK_TARGET_PX };

type TouchGesture = { x: number; y: number; axis: "x" | "y" | null };

/**
 * A video's seek bar: the browser's own slider, with a 24 px tall area to grab.
 * On a touchscreen a sideways drag anywhere on the bar follows the finger (some
 * phones otherwise move it only from the small knob) and a tap jumps there when
 * the finger lifts. A mostly vertical movement is left alone, so a visitor
 * scrolling past the video still scrolls the page.
 */
export function VideoSeekBar({
  currentTime,
  duration,
  onSeek,
  className,
  label = "Seek playback",
}: {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  className?: string;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ currentTime, duration, onSeek });
  // While a finger is on the bar the browser's own slider jumps to it on touch
  // down, even when the visitor is only scrolling; those changes are ignored and
  // the gesture below decides. Cleared just after the finger lifts, so the
  // slider's own change event at touch end is ignored as well.
  const touching = useRef(false);
  useEffect(() => {
    latest.current = { currentTime, duration, onSeek };
  });

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let gesture: TouchGesture | null = null;
    let release = 0;
    const hold = () => {
      window.clearTimeout(release);
      touching.current = true;
    };
    const letGo = () => {
      window.clearTimeout(release);
      release = window.setTimeout(() => {
        touching.current = false;
      }, 0);
    };

    const seekToX = (clientX: number) => {
      const { duration: length, onSeek: seek } = latest.current;
      if (!(length > 0)) return;
      const rect = input.getBoundingClientRect();
      if (rect.width <= 0) return;
      const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      seek(fraction * length);
    };

    const start = (event: TouchEvent) => {
      hold();
      const touch = event.touches[0];
      // A second finger, or none, is not a seek.
      gesture =
        touch && event.touches.length === 1
          ? { x: touch.clientX, y: touch.clientY, axis: null }
          : null;
    };

    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!gesture || !touch || event.touches.length !== 1) {
        gesture = null;
        return;
      }
      if (!gesture.axis) {
        const dx = touch.clientX - gesture.x;
        const dy = touch.clientY - gesture.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SEEK_AXIS_LOCK_PX) return;
        gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      // Up or down: the page scrolls as usual.
      if (gesture.axis === "y") return;
      // Until the length is known there is nothing to seek, so the finger stays the page's.
      if (!(latest.current.duration > 0)) return;
      if (event.cancelable) event.preventDefault();
      seekToX(touch.clientX);
    };

    const end = (event: TouchEvent) => {
      const state = gesture;
      gesture = null;
      if (event.touches.length === 0) letGo();
      // A tap (no movement past the lock) jumps to where the finger lifted.
      if (!state || state.axis) return;
      const touch = event.changedTouches[0];
      seekToX(touch ? touch.clientX : state.x);
    };

    const cancel = (event: TouchEvent) => {
      gesture = null;
      if (event.touches.length === 0) letGo();
    };

    input.addEventListener("touchstart", start, { passive: true });
    // Not passive: once a drag is sideways, the page must not scroll or swipe.
    input.addEventListener("touchmove", move, { passive: false });
    input.addEventListener("touchend", end);
    input.addEventListener("touchcancel", cancel);
    return () => {
      input.removeEventListener("touchstart", start);
      input.removeEventListener("touchmove", move);
      input.removeEventListener("touchend", end);
      input.removeEventListener("touchcancel", cancel);
      window.clearTimeout(release);
      touching.current = false;
    };
  }, []);

  // The slider's own step is fine for dragging; arrow keys move in useful jumps.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const { currentTime: now, duration: length, onSeek: seek } = latest.current;
    if (!(length > 0)) return;
    seek(Math.min(Math.max(now + direction * SEEK_KEY_STEP_SECONDS, 0), length));
  };

  const max = Math.max(duration, 0);
  return (
    <input
      ref={inputRef}
      type="range"
      min={0}
      max={max}
      step={0.1}
      value={Math.min(currentTime, duration || currentTime)}
      onChange={(event) => {
        // React puts the slider back at the current time when this is ignored.
        if (!touching.current) onSeek(Number(event.target.value));
      }}
      onKeyDown={onKeyDown}
      style={TARGET_STYLE}
      className={cn(
        "w-full cursor-pointer touch-pan-y rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300",
        className
      )}
      aria-label={label}
      aria-valuetext={describeVideoProgress(currentTime, duration)}
      data-carousel-control="true"
      data-video-seek
    />
  );
}

/**
 * The quiet progress line every player shows on the video's bottom edge: 2 px,
 * white at 25 % with the played part at 75 %, no knob and no time. The real
 * slider (`VideoSeekBar`) lies over it, invisible, so the 24 px strip can still
 * be dragged, tapped and used with the arrow keys. While held or focused from
 * the keyboard the line grows to 4 px and shows a small dot.
 */
export function VideoProgressLine({
  currentTime,
  duration,
  onSeek,
  className,
}: {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  className?: string;
}) {
  const played = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  return (
    <div className={cn("relative w-full", className)} style={TARGET_STYLE} data-video-progress>
      <VideoSeekBar
        currentTime={currentTime}
        duration={duration}
        onSeek={onSeek}
        className="peer absolute inset-0 block opacity-0"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/25 peer-focus-visible:h-1 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-gold-300 peer-active:h-1 peer-focus-visible:[&_span]:block peer-active:[&_span]:block motion-safe:transition-[height]"
        aria-hidden="true"
      >
        <div className="relative h-full bg-white/75" style={{ width: `${played}%` }}>
          <span className="absolute -right-1.5 top-1/2 hidden h-3 w-3 -translate-y-1/2 rounded-full bg-white" />
        </div>
      </div>
    </div>
  );
}
