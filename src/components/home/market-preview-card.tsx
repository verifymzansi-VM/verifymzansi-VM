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
  provinceCode,
  boosted,
}: MarketPreviewCardProps) {
  return (
    <PosterCardShell
      href={href}
      title={title}
      location={`${city}, ${provinceCode}`}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      mediaAlt={title}
      eyebrow={price != null && price > 0 ? formatPrice(price) : null}
      eyebrowClassName="font-display text-lg font-bold tracking-[0.01em] text-white sm:text-xl"
      statusLabel={boosted ? "Boosted" : null}
      statusClassName="bg-brand-blue/95 text-white border border-white/10"
      accentClassName="hover:border-brand-green/55"
    />
  );
}
