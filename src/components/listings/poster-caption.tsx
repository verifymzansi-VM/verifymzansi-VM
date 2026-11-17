"use client";

import Image from "next/image";
import { MapPin } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

type CaptionSize = "card" | "hero";

/** Pin and town, as on the showroom cards. */
export function CaptionPlace({ location, className }: { location: string; className?: string }) {
  return (
    <p className={cn("flex min-w-0 items-center gap-1 leading-tight", className)}>
      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{location}</span>
    </p>
  );
}

/**
 * The showroom card's caption: price, title, pin and town. Cards show it over
 * their picture; post pages show the same caption over the main photo.
 */
export function PosterCaption({
  eyebrow,
  title,
  location,
  badges,
  size,
  titleAs: TitleTag = "h3",
}: {
  eyebrow?: string | null;
  title: string;
  location?: string | null;
  badges?: ReactNode;
  size: CaptionSize;
  titleAs?: "h3" | "p";
}) {
  const isHero = size === "hero";
  return (
    <div className="min-w-0 flex-1 drop-shadow-md">
      {eyebrow ? (
        <p className={cn("mb-1 font-bold", isHero ? "text-sm sm:text-base" : "text-xs sm:text-sm")}>
          {eyebrow}
        </p>
      ) : null}
      <TitleTag
        className={cn(
          "line-clamp-2 font-semibold leading-tight",
          isHero ? "text-sm sm:text-lg" : "text-[11px] sm:text-sm"
        )}
      >
        {title}
      </TitleTag>
      {location ? (
        <CaptionPlace
          location={location}
          className={cn("mt-1", isHero ? "text-xs sm:text-sm" : "text-[10px] sm:text-xs")}
        />
      ) : null}
      {badges ? <div className="mt-1.5">{badges}</div> : null}
    </div>
  );
}

/**
 * Shading behind captions on a post's main photo: at least 65% black under
 * the text (7:1 for white text even on a white photo), fading out over the
 * top 2.5rem.
 */
const POST_CAPTION_SCRIM =
  "bg-[linear-gradient(to_top,rgb(0_0_0/0.8),rgb(0_0_0/0.65)_calc(100%_-_2.5rem),transparent)] pt-10";

/**
 * Over a video the caption moves up above the controls and stays under the
 * play button, which draws over it.
 */
export const POST_CAPTION_ABOVE_CONTROLS = "bottom-16 z-[5]";

/**
 * Phones only (below `md`): from `md` up the post's heading and price are
 * already on the first screen, beside or just under the photo.
 */
const POST_CAPTION_PHONE_ONLY = "md:hidden";

/**
 * On short phone screens the main photo frame stops above the sticky contact
 * bar, so the caption on it is on the first screen. Most phone photos (3:4)
 * keep their size; only very tall pictures get narrower. The frame keeps its
 * width (a set width stops the 9:16 ratio from narrowing it).
 */
export const POST_MEDIA_FIRST_SCREEN_HEIGHT =
  "max-md:w-full max-md:max-h-[max(20rem,calc(100svh_-_17.5rem))]";

/** True while the post's video plays, from the media events of everything inside. */
export function useMediaPlaying(mediaKey: string) {
  const [state, setState] = useState({ key: mediaKey, playing: false });
  const set = (playing: boolean) => setState({ key: mediaKey, playing });
  return {
    playing: state.key === mediaKey && state.playing,
    handlers: {
      onPlayingCapture: () => set(true),
      onPauseCapture: () => set(false),
      onEndedCapture: () => set(false),
      onErrorCapture: () => set(false),
    },
  };
}

/**
 * The showroom card's caption over a post page's main photo (phones). It
 * repeats the page heading, so screen readers skip it; taps go through to the
 * photo or video under it. Over a video it sits above the controls and fades
 * while the video plays, like the card's.
 */
export function PostMediaCaption({
  eyebrow,
  title,
  location,
  logoUrl,
  overVideo = false,
  playing = false,
}: {
  eyebrow?: string | null;
  title: string;
  location?: string | null;
  logoUrl?: string | null;
  overVideo?: boolean;
  playing?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-post-caption
      className={cn(
        "pointer-events-none absolute inset-x-0 flex items-end gap-2 px-2.5 pb-3 text-white transition-opacity duration-300 motion-reduce:transition-none",
        POST_CAPTION_SCRIM,
        POST_CAPTION_PHONE_ONLY,
        overVideo ? POST_CAPTION_ABOVE_CONTROLS : "bottom-0 z-[15]",
        playing ? "opacity-0" : "opacity-100"
      )}
    >
      <PosterCaption eyebrow={eyebrow} title={title} location={location} size="hero" titleAs="p" />
      {logoUrl ? (
        <Image
          src={normalizeMediaUrl(logoUrl)}
          alt=""
          width={48}
          height={48}
          className="h-10 w-10 shrink-0 rounded-full object-contain drop-shadow-md"
          draggable={false}
        />
      ) : null}
    </div>
  );
}
