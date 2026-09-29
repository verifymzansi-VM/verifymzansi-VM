"use client";

import { memo } from "react";
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
  /** @deprecated Ignored: feed cards carry no trust styling. Kept so existing callers compile. */
  ownerTrustLevel?: TrustLevel;
  ownerName?: string;
  viewCount?: number;
  /**
   * Status flags are accepted for call-site compatibility with ListingCardList,
   * but immersive feed cards deliberately show no status chip.
   */
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
  category,
  attributes,
  imageUrl,
  posterUrl,
  isVideo,
  fitStrategy,
  province: _province,
  city,
  createdAt,
  viewCount,
  logoUrl,
  videoDuration,
  focalX,
  focalY,
  mediaWidth,
  mediaHeight,
}: ListingCardProps) {
  const priceLabel =
    category === "jobs_services"
      ? price > 0
        ? `${formatZARShort(price)}${attributes?.salary_period ? ` / ${String(attributes.salary_period).replace(/^per_/, "")}` : ""}`
        : "Salary not provided"
      : price > 0
        ? formatZARShort(price)
        : null;
  const eyebrow = priceLabel && negotiable ? `${priceLabel} · Neg` : priceLabel;

  return (
    <PosterCardShell
      immersive
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
      accentClassName="hover:border-brand-green/55"
      cardVariant="showcase"
      logoUrl={logoUrl}
      videoDuration={videoDuration}
      focalX={focalX}
      focalY={focalY}
      mediaWidth={mediaWidth}
      mediaHeight={mediaHeight}
    />
  );
});
