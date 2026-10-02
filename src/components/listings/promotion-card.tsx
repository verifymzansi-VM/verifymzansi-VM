"use client";

import { memo } from "react";
import { Tag } from "lucide-react";
import { formatSaShortDate, formatZARShort, saCalendarDaysBetween } from "@/lib/utils/format";
import { useHydrated } from "@/hooks/use-hydrated";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import { useAutoScrollRailItemState } from "@/components/home/auto-scroll-rail";
import { getStoredPromotionTypePresentation } from "@/lib/promotions/type-presentation";
import type { TrustLevel, PromotionType } from "@/types/enums";

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
  /** @deprecated Ignored: feed cards carry no trust styling. Kept so existing callers compile. */
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
  focalX?: number | null;
  focalY?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  disableNativeDrag?: boolean;
  immersive?: boolean;
}

/* ── Urgency helper ─────────────────────────────────────────────── */

/** Countdown label by South African calendar day (not rounded 24-hour blocks). */
export function getUrgencyLabel(endDate: string | null | undefined, now: Date): string | null {
  if (!endDate) return null;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime()) || end.getTime() < now.getTime()) return null; // ended
  const days = saCalendarDaysBetween(now, end);
  if (days <= 0) return "Ends today!";
  if (days === 1) return "Ends tomorrow!";
  if (days <= 3) return `${days} days left`;
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
    parts.push(formatSaShortDate(startDate).toUpperCase());
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
  focalX,
  focalY,
  mediaWidth,
  mediaHeight,
  disableNativeDrag = false,
  immersive = true,
}: PromotionCardProps) {
  const { isActive, isRailDragging } = useAutoScrollRailItemState();
  const typePresentation = getStoredPromotionTypePresentation(promotionType);
  const status = getPromotionStatus(featured, boosted, promotionType);
  // "Now" differs between the server render and hydration, so the countdown is
  // only computed once the card is running in the browser.
  const isHydrated = useHydrated();
  const urgency = isHydrated ? getUrgencyLabel(endDate, new Date()) : null;
  const eyebrow = formatPromotionEyebrow(price, negotiable, promotionType, startDate, urgency);
  const description = buildDescription(businessName);

  return (
    <PosterCardShell
      href={`/tourism-events/${id}`}
      viewTarget={{ type: "promotion", id }}
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
      fitStrategy="smart"
      logoUrl={logoUrl}
      eyebrowClassName={
        price != null && price > 0
          ? undefined
          : "text-[11px] font-bold uppercase tracking-[0.14em] text-brand-green-700 dark:text-brand-green-300 sm:text-xs"
      }
      statusLabel={status?.label}
      statusClassName={status?.className}
      statusVariant="ribbon"
      accentClassName={typePresentation.cardAccentClassName}
      cardVariant="showcase"
      priority={priority}
      videoDuration={videoDuration}
      focalX={focalX}
      focalY={focalY}
      mediaWidth={mediaWidth}
      mediaHeight={mediaHeight}
      disableNativeDrag={disableNativeDrag}
      immersive={immersive}
      feedPlaybackActive={isActive && !isRailDragging}
      fallback={
        <div className="flex h-full w-full items-center justify-center text-white/35">
          <Tag className="h-16 w-16" />
        </div>
      }
    />
  );
});
