"use client";

import { PosterCardShell } from "@/components/listings/poster-card-shell";
import { formatZARShort } from "@/lib/utils/format";
import { useAutoScrollRailItemState } from "@/components/home/auto-scroll-rail";

interface MarketPreviewCardProps {
  href: string;
  imageUrl?: string;
  posterUrl?: string;
  /** Photo or video, from the post's own media; without it the file name decides. */
  isVideo?: boolean;
  title: string;
  price: number | null;
  /** "free" shows "Free" when there is no amount. */
  priceMode?: string | null;
  city: string;
  provinceCode: string;
  boosted?: boolean;
  logoUrl?: string | null;
  priority?: boolean;
  focalX?: number | null;
  focalY?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
}

/** Rand in, the one card price format out ("R1 450"), as on grid cards and the post page. */
const formatPrice = (price: number) => formatZARShort(Math.round(price * 100));

export function MarketPreviewCard({
  href,
  imageUrl,
  posterUrl,
  isVideo,
  title,
  price,
  priceMode,
  city,
  provinceCode: _provinceCode,
  boosted: _boosted,
  logoUrl,
  priority,
  focalX,
  focalY,
  mediaWidth,
  mediaHeight,
}: MarketPreviewCardProps) {
  const { isActive, isRailDragging } = useAutoScrollRailItemState();

  return (
    <PosterCardShell
      immersive
      href={href}
      title={title}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      isVideo={isVideo}
      mediaAlt={title}
      eyebrow={
        price != null && price > 0 ? formatPrice(price) : priceMode === "free" ? "Free" : null
      }
      location={city || null}
      statusLabel={null}
      statusClassName="bg-brand-blue/95 text-white border border-white/10"
      accentClassName="hover:border-brand-green/55"
      cardVariant="showcase"
      logoUrl={logoUrl}
      priority={priority}
      focalX={focalX}
      focalY={focalY}
      mediaWidth={mediaWidth}
      mediaHeight={mediaHeight}
      disableNativeDrag
      feedPlaybackActive={isActive && !isRailDragging}
    />
  );
}
