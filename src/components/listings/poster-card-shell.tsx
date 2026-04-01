"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/card";
import {
  VideoCardPlayer,
  isVideoUrl,
  type MediaFitStrategy,
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
  /** Load the first-visible card's images eagerly for faster above-the-fold paint. */
  priority?: boolean;
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
  mediaSizes = "(max-width: 640px) 240px, 264px",
  trustLevel = 0,
  fallback,
  logoUrl,
  description,
  fitStrategy: _fitStrategy = "smart",
  priority = false,
}: PosterCardShellProps) {
  const normalizedMediaUrl = mediaUrl ? normalizeMediaUrl(mediaUrl) : undefined;
  const normalizedPosterUrl = posterUrl ? normalizeMediaUrl(posterUrl) : undefined;
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;
  const hasVideo = isVideo ?? isVideoUrl(mediaUrl);

  return (
    <Link href={href} className={cn("group block", className)}>
      <Card
        className={cn(
          "overflow-hidden rounded-xl border-transparent bg-warm-100 shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_28px_-8px_rgba(15,23,42,0.28)]",
          accentClassName
        )}
        trustLevel={trustLevel}
      >
        {/* ── 16:9 video/image thumbnail ─────────────────────────── */}
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-900">
          {normalizedMediaUrl ? (
            <VideoCardPlayer
              src={normalizedMediaUrl}
              isVideo={hasVideo}
              posterUrl={normalizedPosterUrl}
              alt={mediaAlt || title}
              sizes={mediaSizes}
              mode={hasVideo ? "hover" : "ambient"}
              fitStrategy="smart"
              containerAspectRatio={16 / 9}
              muteControlVisibility={hasVideo ? "always" : "hidden"}
              mediaClassName="transition-transform duration-700 group-hover:scale-[1.03]"
              priority={priority}
            />
          ) : fallback ? (
            <div className="absolute inset-0 skeleton-shimmer">{fallback}</div>
          ) : (
            <div className="absolute inset-0 skeleton-shimmer" />
          )}

          {/* Status badge — top-left corner of thumbnail */}
          {statusLabel ? (
            <div className="absolute left-2 top-2 z-10">
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
        </div>

        {/* ── Metadata row (YouTube-style below thumbnail) ────────── */}
        <div className={cn("flex gap-3 px-3 py-2.5", contentClassName)}>
          {/* Channel avatar / logo */}
          <div className="mt-0.5 shrink-0">
            {normalizedLogoUrl ? (
              <div className="h-9 w-9 overflow-hidden rounded-full border border-black/8 shadow-sm">
                <Image
                  src={normalizedLogoUrl}
                  alt="Business logo"
                  width={36}
                  height={36}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-blue/12 text-brand-blue/55">
                <span className="text-xs font-bold uppercase leading-none">{title.charAt(0)}</span>
              </div>
            )}
          </div>

          {/* Text meta */}
          <div className="min-w-0 flex-1 space-y-0.5">
            <h3 className="font-display text-[13px] font-semibold leading-snug text-slate-900 line-clamp-2 dark:text-white">
              {title}
            </h3>
            {description ? (
              <p className="text-[11px] leading-snug text-slate-500 line-clamp-1 dark:text-slate-400">
                {description}
              </p>
            ) : null}
            {eyebrow ? (
              <p
                className={cn(
                  "text-[11px] font-semibold text-slate-500 dark:text-slate-400",
                  eyebrowClassName
                )}
              >
                {eyebrow}
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </Link>
  );
}
