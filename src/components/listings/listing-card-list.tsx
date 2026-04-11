"use client";

import { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";
import { VideoDurationBadge } from "@/components/ui/video-duration-badge";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { cn } from "@/lib/utils";
import { formatZARShort } from "@/lib/utils/format";
import { getFocalPositionClassName } from "@/lib/utils/media-position-classes";
import type { TrustLevel } from "@/types/enums";

const CARD_ASPECT_RATIO = 16 / 9;

interface ListingCardListProps {
  id: string;
  title: string;
  price: number;
  negotiable?: boolean;
  imageUrl?: string;
  posterUrl?: string;
  province: string;
  city: string;
  category: string;
  attributes?: Record<string, unknown>;
  condition?: string;
  createdAt: string;
  ownerTrustLevel?: TrustLevel;
  ownerName?: string;
  viewCount?: number;
  boosted?: boolean;
  featured?: boolean;
  urgent?: boolean;
  logoUrl?: string | null;
  focalX?: number | null;
  focalY?: number | null;
  videoDuration?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
}

function isNew(createdAt: string): boolean {
  return new Date().getTime() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000;
}

function getListingStatus(
  featured?: boolean,
  boosted?: boolean,
  urgent?: boolean,
  createdAt?: string
) {
  if (urgent) {
    return {
      label: "Urgent",
      className: "bg-red-500/95 text-white border border-white/10",
    };
  }

  if (createdAt && isNew(createdAt)) {
    return {
      label: "New",
      className: "bg-emerald-500/95 text-white border border-white/10",
    };
  }

  return null;
}

export const ListingCardList = memo(function ListingCardList({
  id,
  title,
  price,
  imageUrl,
  posterUrl,
  province,
  city,
  createdAt,
  ownerTrustLevel = 0,
  boosted,
  featured,
  urgent,
  logoUrl,
  focalX,
  focalY,
  videoDuration,
  mediaWidth: _mediaWidth,
  mediaHeight: _mediaHeight,
}: ListingCardListProps) {
  const isVideo = isVideoUrl(imageUrl);
  const normalizedImageUrl = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;
  const status = getListingStatus(featured, boosted, urgent, createdAt);
  const frameAspectRatio = CARD_ASPECT_RATIO;

  return (
    <Link href={`/listing/${id}`} className="group block">
      <Card
        className="overflow-hidden rounded-xl border-white/10 bg-warm-100 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-green/45 hover:shadow-xl"
        trustLevel={ownerTrustLevel}
      >
        <div className="flex min-h-[140px]">
          <div className="relative w-36 shrink-0 overflow-hidden bg-slate-900 sm:w-40">
            {normalizedImageUrl ? (
              isVideo ? (
                <VideoCardPlayer
                  src={normalizedImageUrl}
                  posterUrl={posterUrl}
                  alt={title}
                  sizes="160px"
                  mode="ambient"
                  fitStrategy="contain"
                  containerAspectRatio={frameAspectRatio}
                  muteControlVisibility="auto"
                  hoverScale={false}
                  focalX={focalX}
                  focalY={focalY}
                />
              ) : (
                <Image
                  src={normalizedImageUrl}
                  alt={title}
                  fill
                  className={cn(
                    "object-cover focal-position-object transition-transform duration-700 group-hover:scale-[1.04]",
                    getFocalPositionClassName(focalX, focalY)
                  )}
                  sizes="160px"
                />
              )
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-warm-300 via-warm-200 to-warm-100 dark:from-warm-800 dark:via-warm-700 dark:to-warm-900" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-black/10" />
            {isVideo ? <VideoDurationBadge seconds={videoDuration} /> : null}
          </div>

          <div className="flex flex-1 flex-col justify-end gap-1.5 p-3 sm:p-3.5">
            {status ? (
              <div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] shadow-sm",
                    status.className
                  )}
                >
                  {status.label}
                </span>
              </div>
            ) : null}

            {price > 0 ? (
              <p className="font-display text-sm font-bold tracking-[0.01em] text-foreground">
                {formatZARShort(price)}
              </p>
            ) : null}

            <h3 className="font-display text-sm font-semibold leading-tight line-clamp-2 group-hover:text-brand-green transition-colors">
              {title}
            </h3>

            <div className="flex items-center gap-2">
              {normalizedLogoUrl ? (
                <div className="h-5 w-5 shrink-0 overflow-hidden rounded-full ring-1 ring-border">
                  <Image
                    src={normalizedLogoUrl}
                    alt={`${title} logo`}
                    width={20}
                    height={20}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : null}
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {city}, {province}
                </span>
              </p>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
});
