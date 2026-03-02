"use client";

import Link from "next/link";
import Image from "next/image";
import { Store, MapPin, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { TrustBadge } from "@/components/trust/trust-badge";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import {
  BUSINESS_TYPE_LABELS,
  type TrustLevel,
  type BusinessType,
  type BusinessCategory,
} from "@/types/enums";
import { VideoCardPlayer, isVideoUrl } from "@/components/ui/video-card-player";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

interface BusinessCardProps {
  id: string;
  businessName: string;
  businessType: BusinessType;
  description?: string;
  coverPhoto?: string | null;
  logoUrl?: string | null;
  province: string;
  city: string;
  trustLevel?: TrustLevel;
  category?: BusinessCategory;
  boostUntil?: string | null;
  featuredUntil?: string | null;
  serviceAreas?: Record<string, unknown> | null;
}

export function BusinessCard({
  id,
  businessName,
  businessType,
  description,
  coverPhoto,
  logoUrl,
  province,
  city,
  trustLevel = 0,
  category,
  boostUntil,
  featuredUntil,
  serviceAreas,
}: BusinessCardProps) {
  const categoryData = BUSINESS_CATEGORIES.find((c) => c.value === category);
  const isBoosted = boostUntil && new Date(boostUntil) > new Date();
  const isFeatured = featuredUntil && new Date(featuredUntil) > new Date();

  const isVideo = isVideoUrl(coverPhoto);
  const normalizedCoverPhoto = coverPhoto ? normalizeMediaUrl(coverPhoto) : undefined;
  const normalizedLogoUrl = logoUrl ? normalizeMediaUrl(logoUrl) : undefined;

  return (
    <Link href={`/mzansi-business/${id}`} className="group block h-full">
      <Card
        className="h-full overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border-brand-blue/20 hover:border-brand-blue/60 flex flex-col"
        trustLevel={trustLevel}
      >
        {/* Banner Image / Video */}
        <div className="relative h-32 sm:h-40 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 overflow-hidden shrink-0">
          {normalizedCoverPhoto ? (
            isVideo ? (
              <VideoCardPlayer
                src={coverPhoto}
                alt={businessName}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                hoverScale={false}
                mediaClassName="transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <Image
                src={normalizedCoverPhoto}
                alt={businessName}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
            )
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-10">
              <Store className="w-16 h-16" />
            </div>
          )}

          {/* Trust Badge overlay */}
          {trustLevel > 0 && (
            <div className="absolute top-2 right-2">
              <TrustBadge level={trustLevel} size="sm" />
            </div>
          )}

          {/* Badges overlay */}
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {categoryData && (
              <Badge className="bg-background/90 backdrop-blur-sm text-foreground hover:bg-background/90 shadow-sm font-medium border-brand-blue/20">
                <categoryData.icon className="w-3 h-3 mr-1 text-brand-blue" />
                {categoryData.label}
              </Badge>
            )}
            {isBoosted && (
              <Badge className="bg-brand-blue text-white hover:bg-brand-blue shadow-sm font-medium text-[10px]">
                Boosted
              </Badge>
            )}
            {isFeatured && (
              <Badge className="bg-amber-500 text-white hover:bg-amber-500 shadow-sm font-medium text-[10px]">
                Featured
              </Badge>
            )}
          </div>

          {/* Business type badge */}
          <div className="absolute bottom-2 left-2">
            <Badge
              variant="outline"
              className="bg-background/80 backdrop-blur-sm text-[10px] font-medium"
            >
              {businessType === "mobile_service" && <Wrench className="w-2.5 h-2.5 mr-1" />}
              {BUSINESS_TYPE_LABELS[businessType]}
            </Badge>
          </div>
        </div>

        <CardContent className="flex-1 p-5 pt-0 relative flex flex-col">
          {/* Floating Logo/Icon */}
          <div className="relative -mt-8 mb-4">
            <div className="w-16 h-16 rounded-xl border-4 border-background bg-background shadow-sm flex items-center justify-center overflow-hidden transition-transform group-hover:scale-105">
              {normalizedLogoUrl ? (
                <Image
                  src={normalizedLogoUrl}
                  alt={`${businessName} logo`}
                  fill
                  className="object-cover"
                />
              ) : (
                <Store className="h-7 w-7 text-brand-blue" />
              )}
            </div>
          </div>

          <div className="space-y-2 flex-1 flex flex-col">
            {/* Title */}
            <h3 className="font-display font-semibold text-lg text-foreground group-hover:text-brand-blue dark:group-hover:text-blue-400 transition-colors line-clamp-1">
              {businessName}
            </h3>

            {/* Description */}
            {description && (
              <p className="text-sm text-muted-foreground line-clamp-2 flex-1">{description}</p>
            )}

            {/* Mobile service badge */}
            {businessType === "mobile_service" && serviceAreas && (
              <p className="text-xs text-brand-blue font-medium">We come to you</p>
            )}

            {/* Location */}
            <div className="pt-3 mt-auto flex items-center gap-1.5 text-xs font-medium text-foreground/80">
              <MapPin className="h-3.5 w-3.5 text-brand-blue" />
              <span className="truncate">
                {city}, {province}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
