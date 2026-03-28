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
  city: _city,
  provinceCode: _provinceCode,
  boosted: _boosted,
  logoUrl,
}: MarketPreviewCardProps) {
  return (
    <PosterCardShell
      href={href}
      title={title}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      mediaAlt={title}
      eyebrow={price != null && price > 0 ? formatPrice(price) : null}
      statusLabel={null}
      statusClassName="bg-brand-blue/95 text-white border border-white/10"
      accentClassName="hover:border-brand-green/55"
      logoUrl={logoUrl}
    />
  );
}
