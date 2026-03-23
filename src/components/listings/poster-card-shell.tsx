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
}: PosterCardShellProps) {
  const normalizedMediaUrl = mediaUrl ? normalizeMediaUrl(mediaUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;
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
        <div className="relative aspect-[3/5] h-full w-full overflow-hidden">
          {normalizedMediaUrl ? (
            hasVideo ? (
              <VideoCardPlayer
                src={mediaUrl}
                posterUrl={normalizedPosterUrl}
                alt={mediaAlt || title}
                sizes={mediaSizes}
                mode="hover"
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

          {/* Lighter gradient — lets media breathe */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute inset-0 ring-1 ring-inset ring-white/12" />

          {/* Status badge / ribbon */}
          {statusLabel ? (
            statusVariant === "ribbon" ? (
              <div className="absolute right-0 top-0 z-10">
                <span
                  className={cn(
                    "relative inline-flex min-h-[1.1rem] items-center rounded-bl-[0.8rem] pl-2.25 pr-1.5 text-[8px] font-black uppercase leading-none tracking-[0.12em] shadow-[0_8px_18px_-14px_rgba(15,23,42,0.92)]",
                    statusClassName
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="absolute -left-[0.32rem] top-0 h-full w-[0.36rem] bg-inherit [clip-path:polygon(100%_0,100%_100%,0_50%)]"
                  />
                  {statusLabel}
                </span>
              </div>
            ) : (
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
            )
          ) : null}

          {/* Business logo — bottom-right */}
          {normalizedLogoUrl ? (
            <div className="absolute bottom-[72px] right-3 z-20 sm:bottom-[80px]">
              <div className="h-9 w-9 overflow-hidden rounded-full ring-2 ring-white/80 shadow-lg">
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
              "absolute inset-x-0 bottom-0 z-10 space-y-1 p-3 sm:p-4",
              contentClassName
            )}
          >
            {eyebrow ? (
              <p
                className={cn(
                  "text-xs font-semibold tracking-[0.01em] text-white/90 sm:text-sm",
                  eyebrowClassName
                )}
              >
                {eyebrow}
              </p>
            ) : null}
            <h3 className="font-display text-sm font-semibold leading-tight text-white drop-shadow-sm line-clamp-1 sm:text-base">
              {title}
            </h3>
            {description ? (
              <p className="text-[11px] leading-snug text-white/60 line-clamp-1 sm:text-xs">
                {description}
              </p>
            ) : null}
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-white/70 line-clamp-1 sm:text-xs">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{location}</span>
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
