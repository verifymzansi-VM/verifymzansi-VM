"use client";

import { memo } from "react";
import { Tag } from "lucide-react";
import { formatZARShort } from "@/lib/utils/format";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import { useAutoScrollRailItemState } from "@/components/home/auto-scroll-rail";
import { getStoredPromotionTypePresentation } from "@/lib/promotions/type-presentation";
import type { TrustLevel, PromotionType } from "@/types/enums";
import type { ContentTargetType } from "@/lib/engagement";

interface PromotionCardProps {
  id: string;
  title: string;
  price: number | null;
  negotiable?: boolean;
  imageUrl?: string;
  posterUrl?: string;
  isVideo?: boolean;
  categoryLabel?: string;
  province: string;
  city: string;
  promotionType: PromotionType;
  createdAt: string;
  ownerTrustLevel?: TrustLevel;
  ownerName?: string;
  viewCount?: number;
  likeCount?: number;
  viewerHasLiked?: boolean;
  boosted?: boolean;
  featured?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  businessName?: string;
  logoUrl?: string | null;
  priority?: boolean;
  videoDuration?: number | null;
  focalX?: number | null;
  focalY?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  disableNativeDrag?: boolean;
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
  startDate?: string | null,
  urgency?: string | null
) {
  const parts: string[] = [];

  if (price != null && price > 0) {
    const formatted = formatZARShort(price);
    parts.push(negotiable ? `${formatted} · Neg` : formatted);
  } else if (startDate) {
    // "SAT 15 MAR" — includes day-of-week for better scannability
    parts.push(
      new Intl.DateTimeFormat("en-ZA", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
        .format(new Date(startDate))
        .toUpperCase()
    );
  }

  if (urgency) parts.push(urgency);

  return parts.length > 0 ? parts.join(" · ") : null;
}

/* ── Card description line ──────────────────────────────────────── */

function buildDescription(businessName?: string): string | null {
  return businessName || null;
}

/* ── Component ──────────────────────────────────────────────────── */

export const PromotionCard = memo(function PromotionCard({
  id,
  title,
  price,
  negotiable,
  imageUrl,
  posterUrl,
  isVideo,
  province: _province,
  city,
  promotionType,
  createdAt,
  ownerTrustLevel = 0,
  ownerName: _ownerName,
  viewCount,
  likeCount,
  categoryLabel: _categoryLabel,
  boosted,
  featured,
  startDate,
  endDate,
  businessName,
  logoUrl,
  priority,
  videoDuration,
  focalX,
  focalY,
  mediaWidth,
  mediaHeight,
  disableNativeDrag = false,
  viewerHasLiked = false,
}: PromotionCardProps) {
  const { isActive, isRailDragging } = useAutoScrollRailItemState();
  const typePresentation = getStoredPromotionTypePresentation(promotionType);
  const status = getPromotionStatus(featured, boosted, promotionType);
  const urgency = getUrgencyLabel(endDate);
  const eyebrow = formatPromotionEyebrow(price, negotiable, promotionType, startDate, urgency);
  const description = buildDescription(businessName);
  const targetType: ContentTargetType = "promotion";

  return (
    <PosterCardShell
      href={`/tourism-events/${id}`}
      title={title}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      isVideo={isVideo}
      mediaAlt={title}
      eyebrow={eyebrow}
      description={description}
      location={city || null}
      createdAt={createdAt}
      viewCount={viewCount}
      likeCount={likeCount}
      viewerHasLiked={viewerHasLiked}
      engagementTargetId={id}
      engagementTargetType={targetType}
      fitStrategy="smart"
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
      cardVariant="showcase"
      trustLevel={ownerTrustLevel}
      priority={priority}
      videoDuration={videoDuration}
      focalX={focalX}
      focalY={focalY}
      mediaWidth={mediaWidth}
      mediaHeight={mediaHeight}
      disableNativeDrag={disableNativeDrag}
      feedPlaybackActive={isActive && !isRailDragging}
      fallback={
        <div className="flex h-full w-full items-center justify-center text-white/35">
          <Tag className="h-16 w-16" />
        </div>
      }
    />
  );
});
