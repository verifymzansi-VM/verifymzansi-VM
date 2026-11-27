"use client";

import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one sound button for every video player (Video mode, post pages, the
 * desktop viewer, cards and the lightbox): a 32 px see-through circle inside a
 * 44 px touch area, at the top centre of the video. The player decides when it
 * shows; `className` may move it (for example below a phone's notch).
 */
export function VideoSoundButton({
  muted,
  onToggle,
  inert,
  className,
}: {
  muted: boolean;
  onToggle: () => void;
  /** Out of reach while faded with the other controls. */
  inert?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      inert={inert}
      data-carousel-control="true"
      data-vm-control
      data-video-sound
      // Cards and carousels must not read the press as a tap on the media.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      className={cn(
        "absolute left-1/2 top-1 z-20 flex h-11 w-11 -translate-x-1/2 touch-manipulation select-none items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300",
        className
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-green-950/75 ring-1 ring-white/20">
        {muted ? (
          <VolumeX className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Volume2 className="h-4 w-4" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
