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
}: PosterCardShellProps) {
  const normalizedMediaUrl = mediaUrl ? normalizeMediaUrl(mediaUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;
  const hasVideo = isVideo ?? isVideoUrl(mediaUrl);

  return (
    <Link href={href} prefetch={false} className={cn("group block h-full", className)}>
      <Card
        className={cn(
          "h-full flex flex-col overflow-hidden border-transparent bg-warm-100 shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_28px_-8px_rgba(15,23,42,0.28)] rounded-xl",
          accentClassName
        )}
        trustLevel={trustLevel}
      >
        {/* ── 4:5 video/image thumbnail ──────────────────────────── */}
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-slate-900 rounded-t-xl">
          {normalizedMediaUrl ? (
            <VideoCardPlayer
              src={normalizedMediaUrl}
              isVideo={hasVideo}
              posterUrl={normalizedPosterUrl}
              alt={mediaAlt || title}
              sizes={mediaSizes}
              mode="ambient"
              fitStrategy={fitStrategy}
              containerAspectRatio={4 / 5}
              muteControlVisibility={hasVideo ? "always" : "hidden"}
              mediaClassName="transition-transform duration-700 group-hover:scale-[1.03]"
              priority={priority}
              focalX={focalX}
              focalY={focalY}
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
        <div className={cn("flex flex-1 gap-2 px-2.5 py-1.5", contentClassName)}>
          {/* Channel avatar / logo */}
          <div className="mt-0.5 shrink-0">
            {normalizedLogoUrl ? (
              <div className="h-7 w-7 overflow-hidden rounded-full border border-black/8 shadow-sm">
                <Image
                  src={normalizedLogoUrl}
                  alt="Business logo"
                  width={28}
                  height={28}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-blue/12 text-brand-blue/55">
                <span className="text-xs font-bold uppercase leading-none">{title.charAt(0)}</span>
              </div>
            )}
          </div>

          {/* Text meta */}
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-xs font-semibold leading-tight text-slate-900 line-clamp-2 dark:text-white sm:text-sm">
              {title}
            </h3>
            {description ? (
              <p className="text-xs leading-tight text-slate-600 line-clamp-1 dark:text-slate-300 sm:text-[13px]">
                {description}
              </p>
            ) : null}
            {location ? (
              <p className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 sm:text-xs">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{location}</span>
              </p>
            ) : null}
            {/* Eyebrow row (price / date) */}
            {eyebrow ? (
              <p
                className={cn(
                  "flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 sm:text-xs",
                  eyebrowClassName
                )}
              >
                <span className="font-semibold">{eyebrow}</span>
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </Link>
  );
}
