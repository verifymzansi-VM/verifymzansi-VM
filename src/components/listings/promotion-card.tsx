"use client";

import { memo } from "react";
import { Tag } from "lucide-react";
import { formatZARShort } from "@/lib/utils/format";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import { getStoredPromotionTypePresentation } from "@/lib/promotions/type-presentation";
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
  priority?: boolean;
}

function getPromotionStatus(
  _featured: boolean | undefined,
  _boosted: boolean | undefined,
  promotionType: PromotionType
) {
  const typePresentation = getStoredPromotionTypePresentation(promotionType);

  return {
    label: typePresentation.cardTagLabel,
    className: typePresentation.cardTagClassName,
  };
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
  province: _province,
  city: _city,
  promotionType,
  ownerTrustLevel = 0,
  boosted,
  featured,
  startDate,
  logoUrl,
  priority,
}: PromotionCardProps) {
  const typePresentation = getStoredPromotionTypePresentation(promotionType);
  const status = getPromotionStatus(featured, boosted, promotionType);
  const eyebrow = formatPromotionEyebrow(price, promotionType, startDate);

  return (
    <PosterCardShell
      href={`/promotion/${id}`}
      title={title}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      mediaAlt={title}
      eyebrow={eyebrow}
      logoUrl={logoUrl}
      eyebrowClassName={
        price != null && price > 0
          ? undefined
          : "text-sm font-semibold uppercase tracking-[0.18em] text-white/84 sm:text-base"
      }
      statusLabel={status?.label}
      statusClassName={status?.className}
      statusVariant="ribbon"
      accentClassName={typePresentation.cardAccentClassName}
      trustLevel={ownerTrustLevel}
      priority={priority}
      fallback={
        <div className="flex h-full w-full items-center justify-center text-white/35">
          <Tag className="h-16 w-16" />
        </div>
      }
    />
  );
});
