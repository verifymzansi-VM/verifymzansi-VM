"use client";

import { memo } from "react";
import { formatZARShort } from "@/lib/utils/format";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import type { MediaFitStrategy } from "@/components/ui/video-card-player";
import type { TrustLevel } from "@/types/enums";
import type { ContentTargetType } from "@/lib/engagement";

interface ListingCardProps {
  id: string;
  title: string;
  price: number;
  negotiable?: boolean;
  imageUrl?: string;
  posterUrl?: string;
  isVideo?: boolean;
  fitStrategy?: MediaFitStrategy;
  province: string;
  city: string;
  category: string;
  attributes?: Record<string, unknown>;
  condition?: string;
  createdAt: string;
  ownerTrustLevel?: TrustLevel;
  ownerName?: string;
  viewCount?: number;
  likeCount?: number;
  viewerHasLiked?: boolean;
  boosted?: boolean;
  featured?: boolean;
  urgent?: boolean;
  logoUrl?: string | null;
  videoDuration?: number | null;
  focalX?: number | null;
  focalY?: number | null;
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

export const ListingCard = memo(function ListingCard({
  id,
  title,
  price,
  negotiable,
  imageUrl,
  posterUrl,
  isVideo,
  fitStrategy,
  province: _province,
  city,
  createdAt,
  ownerTrustLevel = 0,
  viewCount,
  likeCount,
  viewerHasLiked = false,
  boosted,
  featured,
  urgent,
  logoUrl,
  videoDuration,
  focalX,
  focalY,
  mediaWidth,
  mediaHeight,
}: ListingCardProps) {
  const status = getListingStatus(featured, boosted, urgent, createdAt);
  const priceLabel = price > 0 ? formatZARShort(price) : null;
  const eyebrow = priceLabel && negotiable ? `${priceLabel} · Neg` : priceLabel;
  const targetType: ContentTargetType = "listing";

  return (
    <PosterCardShell
      href={`/listing/${id}`}
      title={title}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      isVideo={isVideo}
      fitStrategy={fitStrategy}
      mediaAlt={title}
      location={city || null}
      createdAt={createdAt}
      viewCount={viewCount}
      likeCount={likeCount}
      viewerHasLiked={viewerHasLiked}
      engagementTargetId={id}
      engagementTargetType={targetType}
      eyebrow={eyebrow}
      statusLabel={status?.label}
      statusClassName={status?.className}
      accentClassName="hover:border-brand-green/55"
      trustLevel={ownerTrustLevel}
      logoUrl={logoUrl}
      videoDuration={videoDuration}
      focalX={focalX}
      focalY={focalY}
      mediaWidth={mediaWidth}
      mediaHeight={mediaHeight}
    />
  );
});
