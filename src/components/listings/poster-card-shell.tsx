"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import {
  VideoCardPlayer,
  isVideoUrl,
  type MediaFitStrategy,
  type TouchPreviewBehavior,
} from "@/components/ui/video-card-player";
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
  /** Fit strategy for media in constrained frames. */
  fitStrategy?: MediaFitStrategy;
  /** Fallback preview behavior for touch devices when the card normally uses hover previews. */
  touchPreviewBehavior?: TouchPreviewBehavior;
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
  statusVariant = "pill",
  accentClassName,
  className,
  contentClassName,
  eyebrowClassName,
  mediaSizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  trustLevel = 0,
  fallback,
  logoUrl,
  description,
  fitStrategy = "cover",
  touchPreviewBehavior = "poster",
}: PosterCardShellProps) {
  const normalizedMediaUrl = mediaUrl ? normalizeMediaUrl(mediaUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;
  const hasVideo = isVideo ?? isVideoUrl(mediaUrl);

  return (
    <Link href={href} className={cn("group block h-full", className)}>
      <Card
        className={cn(
          "relative h-full overflow-hidden rounded-[1.5rem] border-white/10 bg-warm-100 text-white shadow-[0_16px_48px_-24px_rgba(15,23,42,0.75)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_64px_-28px_rgba(15,23,42,0.9)] sm:rounded-[1.75rem]",
          accentClassName
        )}
        trustLevel={trustLevel}
      >
        <div className="relative aspect-[5/4] h-full w-full overflow-hidden">
          {normalizedMediaUrl ? (
            <VideoCardPlayer
              src={normalizedMediaUrl}
              posterUrl={normalizedPosterUrl}
              alt={mediaAlt || title}
              sizes={mediaSizes}
              mode={hasVideo ? "hover" : "ambient"}
              touchPreviewBehavior={hasVideo ? touchPreviewBehavior : "ambient"}
              fitStrategy={fitStrategy}
              containerAspectRatio={5 / 4}
              muteControlVisibility={hasVideo ? "always" : "hidden"}
              mediaClassName="transition-transform duration-700 group-hover:scale-[1.04]"
            />
          ) : fallback ? (
            <div className="absolute inset-0 bg-gradient-to-br from-warm-300 via-warm-200 to-warm-100 dark:from-warm-800 dark:via-warm-700 dark:to-warm-900">
              {fallback}
            </div>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-warm-300 via-warm-200 to-warm-100 dark:from-warm-800 dark:via-warm-700 dark:to-warm-900" />
          )}

          <div className="pointer-events-none absolute inset-0 transition-opacity duration-500 group-hover:opacity-0">
            <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/18 to-black/6 sm:from-black/90 sm:via-black/28 sm:to-black/8" />
            <div className="absolute inset-0 ring-1 ring-inset ring-white/10 sm:ring-white/12" />

            {/* Status badge / ribbon */}
            {statusLabel ? (
              statusVariant === "ribbon" ? (
                <div className="absolute left-3 top-3 z-10">
                  <span
                    className={cn(
                      "inline-flex min-h-[1.4rem] items-center rounded-full px-2.5 py-1 text-[9px] font-black uppercase leading-none tracking-[0.16em] shadow-[0_8px_18px_-14px_rgba(15,23,42,0.92)] backdrop-blur-md sm:min-h-[1.1rem] sm:text-[8px]",
                      statusClassName
                    )}
                  >
                    {statusLabel}
                  </span>
                </div>
              ) : (
                <div className="absolute left-3 top-3 z-10">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] shadow-sm backdrop-blur-md sm:px-2.5 sm:text-[10px]",
                      statusClassName
                    )}
                  >
                    {statusLabel}
                  </span>
                </div>
              )
            ) : null}

            {/* Business logo — bottom-right */}
            {normalizedLogoUrl ? (
              <div className="absolute bottom-3 right-3 z-20">
                <div className="h-11 w-11 overflow-hidden rounded-full border border-white/20 ring-2 ring-black/25 shadow-lg backdrop-blur-md sm:h-10 sm:w-10">
                  <Image
                    src={normalizedLogoUrl}
                    alt="Business logo"
                    width={36}
                    height={36}
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            ) : null}

            {/* Bottom content overlay */}
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 z-10 space-y-1.5 p-4 pr-16 sm:space-y-1 sm:p-4 sm:pr-16",
                contentClassName
              )}
            >
              {eyebrow ? (
                <p
                  className={cn(
                    "text-sm font-semibold tracking-[0.01em] text-white/92 sm:text-sm",
                    eyebrowClassName
                  )}
                >
                  {eyebrow}
                </p>
              ) : null}
              <h3 className="font-display text-base font-semibold leading-tight text-white drop-shadow-[0_3px_14px_rgba(15,23,42,0.55)] line-clamp-2 sm:text-sm lg:text-[15px]">
                {title}
              </h3>
              {description ? (
                <p className="text-sm leading-snug text-white/78 line-clamp-2 sm:text-[11px]">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
