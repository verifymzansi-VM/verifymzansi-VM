"use client";

import { memo } from "react";
import { getListingCardStatus } from "@/components/listings/listing-card-status";
import { formatZARShort } from "@/lib/utils/format";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import type { MediaFitStrategy } from "@/components/ui/video-card-player";
import type { TrustLevel } from "@/types/enums";

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
  const status = getListingCardStatus({ featured, boosted, urgent, createdAt });
  const priceLabel = price > 0 ? formatZARShort(price) : null;
  const eyebrow = priceLabel && negotiable ? `${priceLabel} · Neg` : priceLabel;

  return (
    <PosterCardShell
      href={`/listing/${id}`}
      title={title}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      isVideo={isVideo}
      fitStrategy={fitStrategy ?? "smart"}
      mediaAlt={title}
      location={city || null}
      createdAt={createdAt}
      viewCount={viewCount}
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
