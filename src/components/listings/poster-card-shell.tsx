"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin } from "lucide-react";
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
import type { ReactNode } from "react";

const CARD_FRAME = { aspectRatio: 9 / 16, aspectClassName: "aspect-[9/16]" } as const;
type PosterCardVariant = "default" | "showcase" | "hero";
type MediaControlVariant = "default" | "hero";

interface PosterCardShellProps {
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
  /** Business logo URL — rendered as circular overlay bottom-right */
  logoUrl?: string | null;
  /** Short description — 1-line clamp below title */
  description?: string | null;
  /** Location text (city name) — shown with MapPin icon below description */
  location?: string | null;
  /** ISO date string — shown as compact relative time ("2h ago") */
  createdAt?: string | null;
  /** View count — shown as "1.2K views" next to timestamp */
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
  /** Visual treatment used by homepage refresh surfaces. */
  cardVariant?: PosterCardVariant;
  /** Optional hero-specific chrome for media controls. */
  mediaControlVariant?: MediaControlVariant;
  /** Makes the entire card surface clickable even when playback controls are shown. */
  makeEntireCardClickable?: boolean;
}

export function PosterCardShell({
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
  mediaSizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  trustLevel = 0,
  fallback,
  logoUrl,
  description,
  location,
  createdAt: _createdAt,
  viewCount: _viewCount,
  fitStrategy = "smart",
  priority = false,
  videoDuration,
  focalX,
  focalY,
  mediaWidth: _mediaWidth,
  mediaHeight: _mediaHeight,
  videoMode,
  onVideoEnded,
  showPlaybackControl = false,
  cardVariant = "default",
  mediaControlVariant = "default",
  makeEntireCardClickable = false,
}: PosterCardShellProps) {
  const normalizedMediaUrl = mediaUrl ? normalizeMediaUrl(mediaUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;
  const hasVideo = isVideo ?? isVideoUrl(mediaUrl);
  const frame = CARD_FRAME;
  const effectiveFitStrategy = fitStrategy;
  const isHeroVariant = cardVariant === "hero";
  const isShowcaseVariant = cardVariant === "showcase";
  const rootRadiusClassName = isHeroVariant ? "rounded-[28px]" : "rounded-xl";
  const mediaRadiusClassName = isHeroVariant ? "rounded-t-[28px]" : "rounded-t-xl";
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
    ? "text-[12px] sm:text-[13px]"
    : "text-xs sm:text-[13px]";
  const locationClassName = isHeroVariant
    ? "text-[11.5px] sm:text-[12.5px]"
    : "text-[11px] sm:text-xs";
  const eyebrowTextClassName = isHeroVariant
    ? "text-[11.5px] sm:text-[12.5px]"
    : "text-[11px] sm:text-xs";
  const wrapperClassName = cn(
    "group block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    rootRadiusClassName,
    className
  );
  const cardClassName = cn(
    "relative h-full flex flex-col overflow-hidden border-transparent transition-all duration-300",
    isHeroVariant
      ? "border border-white/55 bg-white/95 shadow-[0_30px_80px_-38px_rgba(15,23,42,0.55)] backdrop-blur-xl hover:-translate-y-0.5 hover:shadow-[0_36px_95px_-42px_rgba(15,23,42,0.62)]"
      : isShowcaseVariant
        ? "border border-slate-200/75 bg-white/96 shadow-[0_22px_50px_-34px_rgba(15,23,42,0.38)] backdrop-blur-sm hover:-translate-y-1 hover:shadow-[0_28px_65px_-38px_rgba(15,23,42,0.42)] dark:border-white/10 dark:bg-slate-950/80"
        : "bg-warm-100 shadow-[0_2px_10px_-6px_rgba(15,23,42,0.16)] hover:-translate-y-px hover:shadow-[0_6px_18px_-10px_rgba(15,23,42,0.22)]",
    rootRadiusClassName,
    accentClassName
  );
  const metadataClassName = cn("flex flex-1", contentPaddingClassName, contentClassName);
  const metadataBody = (
    <div className={metadataClassName}>
      {/* Channel avatar / logo */}
      <div className="mt-0.5 shrink-0">
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
              className="h-full w-full object-cover"
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

      {/* Text meta */}
      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            "font-display font-semibold leading-tight text-slate-900 line-clamp-2 dark:text-white",
            titleClassName
          )}
        >
          {title}
        </h3>
        {description ? (
          <p
            className={cn(
              "leading-tight text-slate-600 line-clamp-1 dark:text-slate-300",
              descriptionClassName
            )}
          >
            {description}
          </p>
        ) : null}
        {location ? (
          <p
            className={cn(
              "flex items-center gap-1 text-slate-600 dark:text-slate-300",
              locationClassName
            )}
          >
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
        ) : null}
        {/* Eyebrow row (price / date) */}
        {eyebrow ? (
          <p
            className={cn(
              "flex items-center gap-1 text-slate-600 dark:text-slate-300",
              eyebrowTextClassName,
              eyebrowClassName
            )}
          >
            <span className="font-semibold">{eyebrow}</span>
          </p>
        ) : null}
      </div>
    </div>
  );

  const cardInner = (
    <Card className={cardClassName} trustLevel={trustLevel}>
      {/* ── 9:16 card thumbnail ───────────────────────────────── */}
      <div
        className={cn(
          "relative w-full overflow-hidden bg-slate-900",
          mediaRadiusClassName,
          frame.aspectClassName
        )}
      >
        {normalizedMediaUrl ? (
          <VideoCardPlayer
            src={normalizedMediaUrl}
            isVideo={hasVideo}
            posterUrl={normalizedPosterUrl}
            alt={mediaAlt || title}
            sizes={mediaSizes}
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
            onEnded={onVideoEnded}
            showPlaybackControl={showPlaybackControl}
            controlVariant={mediaControlVariant}
          />
        ) : fallback ? (
          <div className="absolute inset-0 skeleton-shimmer">{fallback}</div>
        ) : (
          <div className="absolute inset-0 skeleton-shimmer" />
        )}

        {/* Status badge — top-left corner of thumbnail */}
        {statusLabel ? (
          <div className="absolute left-2 top-2 z-[6]">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] shadow-md",
                statusClassName
              )}
            >
              {statusLabel}
            </span>
          </div>
        ) : null}

        {/* Duration badge — bottom-right of thumbnail (YouTube-style) */}
        {hasVideo ? <VideoDurationBadge seconds={videoDuration} /> : null}
      </div>

      {/* ── YouTube-style metadata row beneath thumbnail ────────── */}
      {showPlaybackControl && !makeEntireCardClickable ? (
        <Link
          href={href}
          prefetch={false}
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

      {showPlaybackControl && makeEntireCardClickable ? (
        <Link
          href={href}
          prefetch={false}
          aria-label={`Open ${title}`}
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

  if (showPlaybackControl) {
    return <div className={wrapperClassName}>{cardInner}</div>;
  }

  return (
    <Link href={href} prefetch={false} className={wrapperClassName}>
      {cardInner}
    </Link>
  );
}
