"use client";

import { PosterCardShell } from "@/components/listings/poster-card-shell";

interface MarketPreviewCardProps {
  href: string;
  imageUrl?: string;
  posterUrl?: string;
  title: string;
  price: number | null;
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

const formatPrice = (price: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(price);

export function MarketPreviewCard({
  href,
  imageUrl,
  posterUrl,
  title,
  price,
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
  return (
    <PosterCardShell
      href={href}
      title={title}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      mediaAlt={title}
      eyebrow={price != null && price > 0 ? formatPrice(price) : null}
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
    />
  );
}
