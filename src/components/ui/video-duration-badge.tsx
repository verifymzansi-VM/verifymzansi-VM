"use client";

import { cn } from "@/lib/utils";

interface VideoDurationBadgeProps {
  /** Duration in seconds */
  seconds: number | null | undefined;
  className?: string;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoDurationBadge({ seconds, className }: VideoDurationBadgeProps) {
  if (!seconds || seconds <= 0) return null;

  return (
    <span
      className={cn(
        "absolute bottom-1.5 right-1.5 z-[7] rounded px-1 py-0.5 text-[11px] font-medium leading-none text-white bg-black/80",
        className
      )}
      aria-label={`Duration: ${formatDuration(seconds)}`}
    >
      {formatDuration(seconds)}
    </span>
  );
}
