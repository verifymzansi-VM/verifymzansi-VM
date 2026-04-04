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
  videoDuration?: number | null;
}

/* ── Urgency helper ─────────────────────────────────────────────── */

function getUrgencyLabel(endDate?: string | null): string | null {
  if (!endDate) return null;
  const now = new Date();
  const end = new Date(endDate);
  const diffMs = end.getTime() - now.getTime();
  if (diffMs < 0) return null; // already ended
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Ends today!";
  if (diffDays === 1) return "Ends tomorrow!";
  if (diffDays <= 3) return `${diffDays} days left`;
  return null;
}

/* ── Status badge ───────────────────────────────────────────────── */

function getPromotionStatus(
  featured: boolean | undefined,
  boosted: boolean | undefined,
  promotionType: PromotionType
) {
  // Featured / boosted get a premium badge variant
  if (featured) {
    return {
      label: "Featured",
      className: "bg-amber-400 text-amber-950",
    };
  }

  const typePresentation = getStoredPromotionTypePresentation(promotionType);

  if (boosted) {
    return {
      label: `${typePresentation.cardTagLabel} ★`,
      className: typePresentation.cardTagClassName,
    };
  }

  return {
    label: typePresentation.cardTagLabel,
    className: typePresentation.cardTagClassName,
  };
}

/* ── Eyebrow (price / event date) ───────────────────────────────── */

function formatPromotionEyebrow(
  price: number | null,
  negotiable: boolean | undefined,
  promotionType: PromotionType,
  startDate?: string | null
) {
  if (price != null && price > 0) {
    const formatted = formatZARShort(price);
    return negotiable ? `${formatted} · Neg` : formatted;
  }

  if (startDate) {
    // "SAT 15 MAR" — includes day-of-week for better scannability
    return new Intl.DateTimeFormat("en-ZA", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
      .format(new Date(startDate))
      .toUpperCase();
  }

  return null;
}

/* ── Card description line ──────────────────────────────────────── */

function buildDescription(businessName?: string, urgency?: string | null): string | null {
  if (businessName && urgency) return `${businessName} · ${urgency}`;
  if (urgency) return urgency;
  if (businessName) return businessName;
  return null;
}

/* ── Component ──────────────────────────────────────────────────── */

export const PromotionCard = memo(function PromotionCard({
  id,
  title,
  price,
  negotiable,
  imageUrl,
  posterUrl,
  province: _province,
  city,
  promotionType,
  createdAt,
  ownerTrustLevel = 0,
  ownerName: _ownerName,
  viewCount,
  categoryLabel: _categoryLabel,
  boosted,
  featured,
  startDate,
  endDate,
  businessName,
  logoUrl,
  priority,
  videoDuration,
}: PromotionCardProps) {
  const typePresentation = getStoredPromotionTypePresentation(promotionType);
  const status = getPromotionStatus(featured, boosted, promotionType);
  const eyebrow = formatPromotionEyebrow(price, negotiable, promotionType, startDate);
  const urgency = getUrgencyLabel(endDate);
  const description = buildDescription(businessName, urgency);

  return (
    <PosterCardShell
      href={`/promotion/${id}`}
      title={title}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      mediaAlt={title}
      eyebrow={eyebrow}
      description={description}
      location={city || null}
      createdAt={createdAt}
      viewCount={viewCount}
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
      videoDuration={videoDuration}
      fallback={
        <div className="flex h-full w-full items-center justify-center text-white/35">
          <Tag className="h-16 w-16" />
        </div>
      }
    />
  );
});
