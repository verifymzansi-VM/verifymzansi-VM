"use client";

import { memo } from "react";
import { Tag } from "lucide-react";
import { formatZARShort } from "@/lib/utils/format";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import type { TrustLevel, PromotionType } from "@/types/enums";

interface PromotionCardProps {
  id: string;
  title: string;
  price: number | null;
  negotiable?: boolean;
  imageUrl?: string;
  posterUrl?: string;
  categoryLabel?: string;
  province: string;
  city: string;
  promotionType: PromotionType;
  createdAt: string;
  ownerTrustLevel?: TrustLevel;
  ownerName?: string;
  viewCount?: number;
  boosted?: boolean;
  featured?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  businessName?: string;
  logoUrl?: string | null;
}

function getPromotionStatus(featured?: boolean, boosted?: boolean, promotionType?: PromotionType) {
  if (featured) {
    return {
      label: "Featured",
      className: "bg-brand-gold/95 text-amber-950 border border-amber-300/50",
    };
  }

  if (boosted) {
    return {
      label: "Boosted",
      className: "bg-brand-blue/95 text-white border border-white/10",
    };
  }

  if (promotionType === "deal") {
    return {
      label: "Deal",
      className: "bg-red-500/95 text-white border border-white/10",
    };
  }

  if (promotionType === "event") {
    return {
      label: "Event",
      className: "bg-purple-500/95 text-white border border-white/10",
    };
  }

  return null;
}

function formatPromotionEyebrow(
  price: number | null,
  promotionType: PromotionType,
  startDate?: string | null
) {
  if (price != null && price > 0) {
    return formatZARShort(price);
  }

  if (promotionType === "event" && startDate) {
    return new Intl.DateTimeFormat("en-ZA", {
      day: "numeric",
      month: "short",
    })
      .format(new Date(startDate))
      .toUpperCase();
  }

  return null;
}

export const PromotionCard = memo(function PromotionCard({
  id,
  title,
  price,
  imageUrl,
  posterUrl,
  province,
  city,
  promotionType,
  ownerTrustLevel = 0,
  boosted,
  featured,
  startDate,
  logoUrl,
}: PromotionCardProps) {
  const status = getPromotionStatus(featured, boosted, promotionType);
  const eyebrow = formatPromotionEyebrow(price, promotionType, startDate);

  return (
    <PosterCardShell
      href={`/promotion/${id}`}
      title={title}
      location={`${city}, ${province}`}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      mediaAlt={title}
      eyebrow={eyebrow}
      logoUrl={logoUrl}
      eyebrowClassName={
        price != null && price > 0
          ? "font-display text-sm font-bold tracking-[0.01em] text-white sm:text-base"
          : "text-[10px] font-semibold uppercase tracking-[0.18em] text-white/84"
      }
      statusLabel={status?.label}
      statusClassName={status?.className}
      accentClassName="hover:border-red-500/55"
      trustLevel={ownerTrustLevel}
      fallback={
        <div className="flex h-full w-full items-center justify-center text-white/35">
          <Tag className="h-16 w-16" />
        </div>
      }
    />
  );
});
