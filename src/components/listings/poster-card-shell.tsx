"use client";

import { VideoViewTracker } from "@/components/ui/video-view-tracker";

import Link from "next/link";
import Image from "next/image";
import { ImageOff, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  VideoCardPlayer,
  isVideoUrl,
  type MediaFitStrategy,
} from "@/components/ui/video-card-player";
import { VideoDurationBadge } from "@/components/ui/video-duration-badge";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
import type { TrustLevel } from "@/types/enums";
import { useState, type ReactNode } from "react";

const CARD_FRAME = { aspectRatio: 9 / 16, aspectClassName: "aspect-[9/16]" } as const;
type PosterCardVariant = "default" | "showcase" | "hero";
type MediaControlVariant = "default" | "hero";

interface PosterCardShellProps {
  /** Homepage media-only card with fading details over the image. */
  immersive?: boolean;
  href: string;
  title: string;
  mediaUrl?: string | null;
  posterUrl?: string | null;
  /** Explicit media type override for cases where URL extension is unavailable (e.g. blob URLs). */
  isVideo?: boolean;
  mediaAlt?: string;
  /** Small text above title (price, date, etc.) */
  eyebrow?: string | null;
  statusLabel?: string | null;
  statusClassName?: string;
  statusVariant?: "pill" | "ribbon";
  accentClassName?: string;
  className?: string;
  contentClassName?: string;
  eyebrowClassName?: string;
  mediaSizes?: string;
  trustLevel?: TrustLevel;
  fallback?: ReactNode;
  /** Branded artwork shown when the primary media fails or is missing. */
  mediaFallbackUrl?: string | null;
  /** Business logo URL — rendered as circular overlay bottom-right */
  logoUrl?: string | null;
  /** Short description — 1-line clamp below title */
  description?: string | null;
  /** Location text (city name) — shown with MapPin icon below description */
  location?: string | null;
  /** ISO date string — shown as compact relative time ("2h ago") */
  createdAt?: string | null;
  /** View count — shown in the card engagement row. */
  viewCount?: number | null;
  /** Fit strategy for media in constrained frames. */
  fitStrategy?: MediaFitStrategy;
  /** Load the first-visible card's images eagerly for faster above-the-fold paint. */
  priority?: boolean;
  /** Video duration in seconds — shown as badge on thumbnail (e.g. "2:34"). */
  videoDuration?: number | null;
  /** Focal point X coordinate (0..1). Controls object-position when cropping. */
  focalX?: number | null;
  /** Focal point Y coordinate (0..1). Controls object-position when cropping. */
  focalY?: number | null;
  /** Source media width in pixels (if known). Used for adaptive card frame selection. */
  mediaWidth?: number | null;
  /** Source media height in pixels (if known). Used for adaptive card frame selection. */
  mediaHeight?: number | null;
  /** Override the default video playback mode ("hover") for this card. */
  videoMode?: "hover" | "ambient" | "interactive";
  /** Called when an active video finishes playing (carousel auto-advance). */
  onVideoEnded?: () => void;
  /** Show play/pause toggle on ambient video cards (e.g. showroom center card). */
  showPlaybackControl?: boolean;
  /** Links the card's ambient playback to the sticky showroom autoplay intent. */
  stickyAutoplay?: boolean;
  /** Visual treatment used by homepage refresh surfaces. */
  cardVariant?: PosterCardVariant;
  /** Optional hero-specific chrome for media controls. */
  mediaControlVariant?: MediaControlVariant;
  /** Makes the entire card surface clickable even when playback controls are shown. */
  makeEntireCardClickable?: boolean;
  /** Prevents the browser from treating card surfaces as native drag sources. */
  disableNativeDrag?: boolean;
  /** Allows parent rails to gate autoplay to the focused card only. */
  feedPlaybackActive?: boolean;
  /** Keeps hero videos poster-first until the user explicitly starts playback. */
  deferVideoLoadUntilPlay?: boolean;
}

export function PosterCardShell({
  immersive = false,
  href,
  title,
  mediaUrl,
  posterUrl,
  isVideo,
  mediaAlt,
  eyebrow,
  statusLabel,
  statusClassName,
  statusVariant: _statusVariant = "pill",
  accentClassName,
  className,
  contentClassName,
  eyebrowClassName,
  mediaSizes = "(max-width: 640px) 72vw, (max-width: 1024px) 50vw, 33vw",
  trustLevel = 0,
  fallback,
  mediaFallbackUrl,
  logoUrl,
  description,
  location,
  createdAt: _createdAt,
  viewCount: _viewCount,
  fitStrategy = "contain",
  priority = false,
  videoDuration,
  focalX,
  focalY,
  mediaWidth,
  mediaHeight,
  videoMode,
  onVideoEnded,
  showPlaybackControl = false,
  stickyAutoplay = false,
  cardVariant = "default",
  mediaControlVariant = "default",
  makeEntireCardClickable = false,
  disableNativeDrag: disableNativeDragProp = false,
  feedPlaybackActive = true,
  deferVideoLoadUntilPlay = false,
}: PosterCardShellProps) {
  const [mediaPlaying, setMediaPlaying] = useState(false);
  const normalizedMediaUrl = mediaUrl ? normalizeMediaUrl(mediaUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;
  const normalizedMediaFallbackUrl = mediaFallbackUrl
    ? normalizeMediaUrl(mediaFallbackUrl)
    : undefined;
  const hasVideo = isVideo ?? isVideoUrl(mediaUrl);
  const frame = CARD_FRAME;
  // Keep hero media mounted as cards move between active and side slots.
  const hasIndependentControls =
    hasVideo || showPlaybackControl || (cardVariant === "hero" && makeEntireCardClickable);
  const effectiveFitStrategy = immersive ? "cover" : fitStrategy;
  const isHeroVariant = cardVariant === "hero";
  const isShowcaseVariant = cardVariant === "showcase";
  const disableNativeDrag = disableNativeDragProp || isHeroVariant;
  const rootRadiusClassName = immersive
    ? "rounded-[20px]"
    : isHeroVariant
      ? "rounded-[28px]"
      : "rounded-xl";
  const mediaRadiusClassName = isHeroVariant
    ? "rounded-t-[28px]"
    : isShowcaseVariant
      ? "rounded-xl"
      : "rounded-t-xl";
  const contentPaddingClassName = isHeroVariant
    ? "gap-3 px-3.5 py-3"
    : isShowcaseVariant
      ? "gap-2.5 px-3 py-2.5"
      : "gap-2 px-2.5 py-1.5";
  const logoSizeClassName = isHeroVariant
    ? "h-8 w-8"
    : isShowcaseVariant
      ? "h-[30px] w-[30px]"
      : "h-7 w-7";
  const titleClassName = isHeroVariant
    ? "text-sm sm:text-[15px]"
    : isShowcaseVariant
      ? "text-[13px] sm:text-[14px]"
      : "text-xs sm:text-sm";
  const descriptionClassName = isHeroVariant
    ? "text-[12px] leading-[18px]"
    : "text-xs sm:text-[13px]";
  const locationClassName = isHeroVariant
    ? "text-[11.5px] leading-[17px]"
    : "text-[11px] sm:text-xs";
  const eyebrowTextClassName = isHeroVariant
    ? "text-[11.5px] leading-[17px]"
    : "text-[11px] sm:text-xs";
  const wrapperClassName = cn(
    "group/poster group relative block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    rootRadiusClassName,
    className
  );
  const handleNativeDragStart = (event: React.DragEvent<HTMLElement>) => {
    if (disableNativeDrag) {
      event.preventDefault();
    }
  };
  const cardClassName = cn(
    "relative h-full w-full flex flex-col overflow-hidden border-transparent transition-all duration-300",
    isHeroVariant && !immersive
      ? "border border-slate-200 bg-white text-slate-950 elev-lg ring-1 ring-black/5 hover:-translate-y-0.5 hover:elev-xl dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:ring-white/10"
      : isShowcaseVariant || immersive
        ? "border-transparent bg-transparent shadow-none hover:-translate-y-0.5 hover:border-transparent hover:bg-transparent hover:shadow-none dark:bg-transparent"
        : "border border-border/60 bg-card elev-xs hover:-translate-y-px hover:elev-sm hover:border-foreground/15 dark:bg-card dark:text-white",
    rootRadiusClassName,
    accentClassName
  );
  const metadataClassName = cn("flex flex-1", contentPaddingClassName, contentClassName);
  const metadataBody = (
    <div className={metadataClassName} data-card-metadata>
      {/* Channel avatar / logo — the nudge uses translate so it does not
          inflate the height-capped metadata row's scroll height. */}
      <div className={cn("shrink-0", isHeroVariant ? "translate-y-0.5" : "mt-0.5")}>
        {normalizedLogoUrl ? (
          <div
            className={cn(
              "overflow-hidden rounded-full border border-black/8 shadow-sm",
              logoSizeClassName
            )}
          >
            <Image
              src={normalizedLogoUrl}
              alt={`${title} logo`}
              width={isHeroVariant ? 32 : 28}
              height={isHeroVariant ? 32 : 28}
              loading="lazy"
              className="h-full w-full object-contain"
              draggable={disableNativeDrag ? false : undefined}
              onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
            />
          </div>
        ) : (
          <div
            className={cn(
              "flex items-center justify-center rounded-full bg-brand-blue/12 text-brand-blue/55",
              logoSizeClassName
            )}
          >
            <span className="text-xs font-bold uppercase leading-none">{title.charAt(0)}</span>
          </div>
        )}
      </div>

      {/* Text meta — title, optional supporting line, one combined info row */}
      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            "font-display font-semibold leading-tight text-foreground",
            // Hero/showroom metadata is height-capped (64px); a wrapped title
            // would overflow the row, so keep it to a single line there.
            isHeroVariant ? "truncate" : "line-clamp-2",
            titleClassName
          )}
        >
          {title}
        </h3>
        {description && !isHeroVariant ? (
          // Showroom (hero) metadata is capped at two compact rows
          // (title + location/price); other surfaces keep the extra line.
          <p
            className={cn(
              "mt-0.5 leading-tight text-muted-foreground line-clamp-1",
              descriptionClassName
            )}
          >
            {description}
          </p>
        ) : null}
        {eyebrow || location ? (
          <p
            className={cn(
              "mt-0.5 flex min-w-0 items-center gap-1 leading-tight text-muted-foreground",
              locationClassName
            )}
          >
            {eyebrow ? (
              <span
                className={cn(
                  "shrink-0 font-semibold text-foreground",
                  eyebrowTextClassName,
                  eyebrowClassName
                )}
              >
                {eyebrow}
              </span>
            ) : null}
            {eyebrow && location ? (
              <span aria-hidden="true" className="shrink-0 text-muted-foreground/50">
                ·
              </span>
            ) : null}
            {location ? (
              <span className="flex min-w-0 items-center gap-0.5">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{location}</span>
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
  const mediaFallback =
    fallback ??
    (normalizedMediaFallbackUrl ? (
      <div className="relative h-full w-full overflow-hidden bg-slate-100 dark:bg-slate-950">
        <Image
          src={normalizedMediaFallbackUrl}
          alt=""
          fill
          sizes={mediaSizes}
          priority={priority}
          {...(priority ? {} : { loading: "lazy" as const })}
          className="object-contain"
          aria-hidden="true"
          draggable={disableNativeDrag ? false : undefined}
          onDragStart={disableNativeDrag ? handleNativeDragStart : undefined}
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 via-slate-950/34 to-transparent px-4 pb-4 pt-12 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
            Public preview
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-tight">{title}</p>
        </div>
      </div>
    ) : (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 bg-[linear-gradient(160deg,hsl(37_30%_95%)_0%,hsl(37_24%_89%)_100%)] px-6 text-center dark:bg-[linear-gradient(160deg,hsl(30_12%_14%)_0%,hsl(30_10%_10%)_100%)]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/70 text-warm-400 shadow-sm ring-1 ring-black/5 dark:bg-white/5 dark:text-warm-500 dark:ring-white/10">
          <ImageOff className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-warm-700 dark:text-warm-300">No photo yet</p>
          <p className="line-clamp-2 text-xs text-warm-500 dark:text-warm-400">{title}</p>
        </div>
      </div>
    ));

  const cardInner = (
    <Card
      className={cardClassName}
      trustLevel={trustLevel}
      data-card-variant={cardVariant}
      data-card-immersive={immersive || undefined}
      onPlayingCapture={immersive ? () => setMediaPlaying(true) : undefined}
      onPauseCapture={immersive ? () => setMediaPlaying(false) : undefined}
      onEndedCapture={immersive ? () => setMediaPlaying(false) : undefined}
      onErrorCapture={immersive ? () => setMediaPlaying(false) : undefined}
    >
      {/* ── 9:16 card thumbnail ───────────────────────────────── */}
      <div
        data-card-media
        className={cn(
          "relative w-full overflow-hidden bg-slate-900",
          mediaRadiusClassName,
          immersive ? "aspect-[9/16] rounded-[20px]" : frame.aspectClassName
        )}
      >
        {normalizedMediaUrl ? (
          <VideoViewTracker href={href}>
            <VideoCardPlayer
              src={normalizedMediaUrl}
              isVideo={hasVideo}
              posterUrl={normalizedPosterUrl}
              alt={mediaAlt || title}
              sizes={immersive ? "(max-width: 640px) 50vw, 296px" : mediaSizes}
              mode={videoMode ?? "hover"}
              fitStrategy={effectiveFitStrategy}
              containerAspectRatio={frame.aspectRatio}
              muteControlVisibility={hasVideo ? "always" : "hidden"}
              hoverScale={!hasVideo}
              mediaClassName={
                hasVideo ? undefined : "transition-transform duration-700 group-hover:scale-[1.03]"
              }
              priority={priority}
              focalX={focalX}
              focalY={focalY}
              mediaWidth={mediaWidth}
              mediaHeight={mediaHeight}
              onEnded={onVideoEnded}
              showPlaybackControl={showPlaybackControl}
              stickyAutoplay={stickyAutoplay}
              controlVariant={mediaControlVariant}
              feedPlaybackActive={feedPlaybackActive}
              deferVideoLoadUntilPlay={deferVideoLoadUntilPlay}
              disableNativeDrag={disableNativeDrag}
              fallback={mediaFallback}
            />
          </VideoViewTracker>
        ) : (
          <div className="absolute inset-0">{mediaFallback}</div>
        )}

        {/* Status badge — top-left corner of thumbnail */}
        {statusLabel && !immersive ? (
          <div className="absolute left-2 top-2 z-[6]">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] shadow-md ring-1 ring-black/10",
                statusClassName
              )}
            >
              {statusLabel}
            </span>
          </div>
        ) : null}

        {/* Duration badge — bottom-right of thumbnail (YouTube-style) */}
        {hasVideo && !immersive ? <VideoDurationBadge seconds={videoDuration} /> : null}
        {immersive ? (
          <div
            data-card-overlay
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex items-end gap-2 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2.5 pb-3 pt-10 text-white transition-opacity duration-300 motion-reduce:transition-none",
              mediaPlaying ? "opacity-0" : "opacity-100",
              !hasVideo && "group-hover/poster:opacity-0 group-active/poster:opacity-0"
            )}
          >
            <div className="min-w-0 flex-1 drop-shadow-md">
              {eyebrow ? <p className="mb-1 text-xs font-bold sm:text-sm">{eyebrow}</p> : null}
              <h3 className="line-clamp-2 text-[11px] font-semibold leading-tight sm:text-sm">
                {title}
              </h3>
              {location ? (
                <p className="mt-1 flex min-w-0 items-center gap-1 text-[10px] leading-tight sm:text-xs">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{location}</span>
                </p>
              ) : null}
            </div>
            {normalizedLogoUrl ? (
              <Image
                src={normalizedLogoUrl}
                alt={`${title} logo`}
                width={36}
                height={36}
                className="h-8 w-8 shrink-0 rounded-full object-contain drop-shadow-md sm:h-10 sm:w-10"
                draggable={false}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── YouTube-style metadata row beneath thumbnail ────────── */}
      {immersive ? null : hasIndependentControls && !makeEntireCardClickable ? (
        <Link
          href={href}
          prefetch={false}
          data-carousel-link={disableNativeDrag ? "true" : undefined}
          draggable={disableNativeDrag ? false : undefined}
          onDragStart={handleNativeDragStart}
          className={cn(
            "block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isHeroVariant ? "rounded-b-[28px]" : "rounded-b-xl"
          )}
        >
          {metadataBody}
        </Link>
      ) : (
        metadataBody
      )}

      {hasIndependentControls && (makeEntireCardClickable || immersive) ? (
        <Link
          href={href}
          prefetch={false}
          aria-label={`Open ${title}`}
          data-carousel-link={disableNativeDrag ? "true" : undefined}
          draggable={disableNativeDrag ? false : undefined}
          onDragStart={handleNativeDragStart}
          className={cn(
            "absolute inset-0 z-[4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            rootRadiusClassName
          )}
        >
          <span className="sr-only">{`Open ${title}`}</span>
        </Link>
      ) : null}
    </Card>
  );

  if (hasIndependentControls) {
    return <div className={wrapperClassName}>{cardInner}</div>;
  }

  return (
    <div className={wrapperClassName}>
      <Link
        href={href}
        prefetch={false}
        data-carousel-link={disableNativeDrag ? "true" : undefined}
        draggable={disableNativeDrag ? false : undefined}
        onDragStart={handleNativeDragStart}
        className={cn(
          "block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          rootRadiusClassName
        )}
      >
        {cardInner}
      </Link>
    </div>
  );
}
