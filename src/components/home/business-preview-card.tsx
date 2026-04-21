"use client";

import { Store } from "lucide-react";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import { useAutoScrollRailItemState } from "@/components/home/auto-scroll-rail";
import { BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";
import type { BusinessType } from "@/types/enums";

interface BusinessPreviewCardProps {
  href: string;
  imageUrl?: string;
  posterUrl?: string;
  logoUrl?: string;
  title: string;
  businessType: BusinessType;
  city: string;
  provinceCode: string;
  boosted?: boolean;
  featured?: boolean;
  viewCount?: number;
  priority?: boolean;
  focalX?: number | null;
  focalY?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
}

export function BusinessPreviewCard({
  href,
  imageUrl,
  posterUrl,
  logoUrl,
  title,
  businessType,
  city,
  provinceCode: _provinceCode,
  boosted: _boosted,
  featured: _featured,
  viewCount,
  priority,
  focalX,
  focalY,
  mediaWidth,
  mediaHeight,
}: BusinessPreviewCardProps) {
  const { isActive, isRailDragging } = useAutoScrollRailItemState();
  const typeLabel =
    BUSINESS_TYPE_OPTIONS.find((t) => t.value === businessType)?.label || businessType;

  return (
    <PosterCardShell
      href={href}
      title={title}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      mediaAlt={title}
      description={typeLabel || null}
      location={city || null}
      logoUrl={logoUrl}
      statusLabel={null}
      statusClassName={undefined}
      accentClassName="hover:border-brand-blue/55"
      cardVariant="showcase"
      viewCount={viewCount}
      priority={priority}
      focalX={focalX}
      focalY={focalY}
      mediaWidth={mediaWidth}
      mediaHeight={mediaHeight}
      disableNativeDrag
      feedPlaybackActive={isActive && !isRailDragging}
      fallback={
        <div className="flex h-full w-full items-center justify-center text-brand-blue/35">
          <Store className="h-16 w-16" />
        </div>
      }
    />
  );
}
