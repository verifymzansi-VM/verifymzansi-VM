"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin, Store } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";
import { BUSINESS_TYPE_LABELS, type BusinessType } from "@/types/enums";
import { Badge } from "@/components/ui/badge";

interface BusinessPreviewCardProps {
  href: string;
  imageUrl?: string;
  posterUrl?: string;
  logoUrl?: string;
  title: string;
  businessType: BusinessType;
  city: string;
  provinceCode: string;
}

export function BusinessPreviewCard({
  href,
  imageUrl,
  posterUrl,
  logoUrl,
  title,
  businessType,
  city,
  provinceCode,
}: BusinessPreviewCardProps) {
  const isVideo = isVideoUrl(imageUrl);
  const normalizedImageUrl = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;

  return (
    <Link
      href={href}
      className="group block w-full rounded-xl overflow-hidden border border-warm-200 dark:border-warm-700 bg-white dark:bg-warm-900 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-brand-blue-400"
      style={{ touchAction: "manipulation" }}
    >
      {/* Banner */}
      <div className="relative h-28 sm:h-32 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 overflow-hidden">
        {normalizedImageUrl ? (
          isVideo ? (
            <VideoCardPlayer
              src={imageUrl}
              posterUrl={posterUrl}
              alt={title}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              hoverScale={false}
              mediaClassName="transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <Image
              src={normalizedImageUrl}
              alt={title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-10">
            <Store className="w-12 h-12" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-3 pt-0 pb-3 relative">
        {/* Floating Logo */}
        <div className="relative -mt-6 mb-2">
          <div className="w-12 h-12 rounded-xl border-3 border-background bg-background shadow-sm flex items-center justify-center overflow-hidden transition-transform group-hover:scale-105">
            {normalizedLogoUrl ? (
              <Image src={normalizedLogoUrl} alt={`${title} logo`} fill className="object-cover" />
            ) : (
              <Store className="h-5 w-5 text-brand-blue" />
            )}
          </div>
        </div>

        {/* Business name */}
        <h4 className="font-semibold text-sm text-foreground group-hover:text-brand-blue transition-colors line-clamp-1">
          {title}
        </h4>

        {/* Type badge */}
        <Badge variant="outline" className="mt-1 text-[10px] font-medium h-5">
          {BUSINESS_TYPE_LABELS[businessType]}
        </Badge>

        {/* Location */}
        <p className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
          <MapPin className="h-3 w-3 flex-shrink-0 text-brand-blue" />
          {city}, {provinceCode}
        </p>
      </div>
    </Link>
  );
}
