"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
import type { TrustLevel } from "@/types/enums";
import type { ReactNode } from "react";

interface PosterCardShellProps {
  href: string;
  title: string;
  location: string;
  mediaUrl?: string | null;
  posterUrl?: string | null;
  mediaAlt?: string;
  eyebrow?: string | null;
  statusLabel?: string | null;
  statusClassName?: string;
  accentClassName?: string;
  className?: string;
  contentClassName?: string;
  eyebrowClassName?: string;
  mediaSizes?: string;
  trustLevel?: TrustLevel;
  fallback?: ReactNode;
}

export function PosterCardShell({
  href,
  title,
  location,
  mediaUrl,
  posterUrl,
  mediaAlt,
  eyebrow,
  statusLabel,
  statusClassName,
  accentClassName,
  className,
  contentClassName,
  eyebrowClassName,
  mediaSizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
  trustLevel = 0,
  fallback,
}: PosterCardShellProps) {
  const normalizedMediaUrl = mediaUrl ? normalizeMediaUrl(mediaUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const hasVideo = isVideoUrl(mediaUrl);

  return (
    <Link href={href} className={cn("group block h-full", className)}>
      <Card
        className={cn(
          "relative h-full overflow-hidden rounded-[1.75rem] border-white/10 bg-warm-100 text-white shadow-[0_16px_48px_-24px_rgba(15,23,42,0.75)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_64px_-28px_rgba(15,23,42,0.9)]",
          accentClassName
        )}
        trustLevel={trustLevel}
      >
        <div className="relative aspect-[9/14] h-full w-full overflow-hidden">
          {normalizedMediaUrl ? (
            hasVideo ? (
              <VideoCardPlayer
                src={mediaUrl}
                posterUrl={normalizedPosterUrl}
                alt={mediaAlt || title}
                sizes={mediaSizes}
                mode="ambient"
                mediaClassName="transition-transform duration-700 group-hover:scale-[1.04]"
              />
            ) : (
              <Image
                src={normalizedMediaUrl}
                alt={mediaAlt || title}
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                sizes={mediaSizes}
              />
            )
          ) : fallback ? (
            <div className="absolute inset-0 bg-gradient-to-br from-warm-300 via-warm-200 to-warm-100 dark:from-warm-800 dark:via-warm-700 dark:to-warm-900">
              {fallback}
            </div>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-warm-300 via-warm-200 to-warm-100 dark:from-warm-800 dark:via-warm-700 dark:to-warm-900" />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/28 to-black/8" />
          <div className="absolute inset-0 ring-1 ring-inset ring-white/12" />

          {statusLabel ? (
            <div className="absolute left-3 top-3 z-10">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] shadow-sm backdrop-blur-md",
                  statusClassName
                )}
              >
                {statusLabel}
              </span>
            </div>
          ) : null}

          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-10 space-y-1.5 p-3 sm:p-4",
              contentClassName
            )}
          >
            {eyebrow ? (
              <p
                className={cn(
                  "text-sm font-semibold tracking-[0.01em] text-white/92 sm:text-base",
                  eyebrowClassName
                )}
              >
                {eyebrow}
              </p>
            ) : null}
            <h3 className="font-display text-base font-semibold leading-tight text-white drop-shadow-sm line-clamp-1 sm:text-lg">
              {title}
            </h3>
            <p className="flex items-center gap-1.5 text-xs font-medium text-white/78 line-clamp-1 sm:text-[13px]">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{location}</span>
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
