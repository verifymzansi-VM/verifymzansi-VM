"use client";

import { memo } from "react";
import { formatZARShort } from "@/lib/utils/format";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import type { TrustLevel } from "@/types/enums";

interface ListingCardProps {
  id: string;
  title: string;
  price: number;
  negotiable?: boolean;
  imageUrl?: string;
  posterUrl?: string;
  isVideo?: boolean;
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
  imageUrl,
  posterUrl,
  isVideo,
  province,
  city,
  createdAt,
  ownerTrustLevel = 0,
  boosted,
  featured,
  urgent,
  logoUrl,
}: ListingCardProps) {
  const status = getListingStatus(featured, boosted, urgent, createdAt);

  return (
    <PosterCardShell
      href={`/listing/${id}`}
      title={title}
      location={`${city}, ${province}`}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      isVideo={isVideo}
      mediaAlt={title}
      eyebrow={price > 0 ? formatZARShort(price) : null}
      eyebrowClassName="font-display text-sm font-bold tracking-[0.01em] text-white sm:text-base"
      statusLabel={status?.label}
      statusClassName={status?.className}
      accentClassName="hover:border-brand-green/55"
      trustLevel={ownerTrustLevel}
      logoUrl={logoUrl}
    />
  );
});
