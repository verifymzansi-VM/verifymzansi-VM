"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { describeVideoProgress } from "@/lib/media/video-time";
import { cn } from "@/lib/utils";

/** Height of the seek bar's touch and click area; the visible track stays thin (WCAG 2.5.8). */
export const SEEK_TARGET_PX = 24;

const TARGET_STYLE: CSSProperties = { height: SEEK_TARGET_PX };

/**
 * A video's seek bar: the browser's own slider, with a 24 px tall area to grab.
 * On a touchscreen the whole bar follows the finger, so a tap jumps there and a
 * drag can start anywhere on it (some phones otherwise move it only from the
 * small knob), and the page neither scrolls nor swipes while dragging.
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
  const latest = useRef({ duration, onSeek });
  useEffect(() => {
    latest.current = { duration, onSeek };
  });

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const follow = (event: TouchEvent) => {
      const touch = event.touches[0];
      // Not passive: the browser's own slider and page scrolling leave this finger to us.
      event.preventDefault();
      const { duration: length, onSeek: seek } = latest.current;
      if (!touch || !(length > 0)) return;
      const rect = input.getBoundingClientRect();
      if (rect.width <= 0) return;
      const fraction = Math.min(Math.max((touch.clientX - rect.left) / rect.width, 0), 1);
      seek(fraction * length);
    };
    input.addEventListener("touchstart", follow, { passive: false });
    input.addEventListener("touchmove", follow, { passive: false });
    return () => {
      input.removeEventListener("touchstart", follow);
      input.removeEventListener("touchmove", follow);
    };
  }, []);

  const max = Math.max(duration, 0);
  return (
    <input
      ref={inputRef}
      type="range"
      min={0}
      max={max}
      step={0.1}
      value={Math.min(currentTime, duration || currentTime)}
      onChange={(event) => onSeek(Number(event.target.value))}
      style={TARGET_STYLE}
      className={cn("w-full cursor-pointer touch-none", className)}
      aria-label={label}
      aria-valuetext={describeVideoProgress(currentTime, duration)}
      data-carousel-control="true"
      data-video-seek
    />
  );
}
