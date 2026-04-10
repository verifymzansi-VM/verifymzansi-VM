"use client";

import { Store } from "lucide-react";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import { BUSINESS_CATEGORIES, BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";
import type { TrustLevel, BusinessType, BusinessCategory } from "@/types/enums";

interface BusinessCardProps {
  id: string;
  businessName: string;
  businessType: BusinessType;
  description?: string;
  coverPhoto?: string | null;
  coverVideo?: string | null;
  videoThumbnail?: string | null;
  logoUrl?: string | null;
  galleryPhotos?: string[] | null;
  province: string;
  city: string;
  trustLevel?: TrustLevel;
  category?: BusinessCategory;
  subcategory?: string | null;
  boostUntil?: string | null;
  featuredUntil?: string | null;
  serviceAreas?: Record<string, unknown> | null;
  videoDuration?: number | null;
  focalX?: number | null;
  focalY?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
}

function getBusinessStatus(
  boostUntil?: string | null,
  featuredUntil?: string | null
): { label: string; className: string } | null {
  const now = new Date();
  if (featuredUntil && new Date(featuredUntil) > now) {
    return { label: "Featured", className: "bg-amber-400 text-amber-950" };
  }
  if (boostUntil && new Date(boostUntil) > now) {
    return { label: "Boosted", className: "bg-brand-blue text-white" };
  }
  return null;
}

function buildBusinessDescription(
  category?: BusinessCategory,
  subcategory?: string | null,
  businessType?: BusinessType,
  description?: string
): string | null {
  const parts: string[] = [];

  // Category label
  if (category) {
    const catDef = BUSINESS_CATEGORIES.find((c) => c.value === category);
    if (catDef) {
      // If subcategory exists, show subcategory label (more specific); otherwise show category
      if (subcategory) {
        const subDef = catDef.subcategories.find((s) => s.value === subcategory);
        if (subDef) parts.push(subDef.label);
        else parts.push(catDef.label);
      } else {
        parts.push(catDef.label);
      }
    }
  }

  // Business type label
  if (businessType) {
    const typeDef = BUSINESS_TYPE_OPTIONS.find((t) => t.value === businessType);
    if (typeDef) parts.push(typeDef.label);
  }

  if (parts.length > 0) return parts.join(" · ");
  if (description) return description;
  return null;
}

export function BusinessCard({
  id,
  businessName,
  businessType,
  description: _description,
  coverPhoto,
  coverVideo,
  videoThumbnail,
  logoUrl,
  galleryPhotos,
  province: _province,
  city,
  trustLevel = 0,
  category,
  subcategory,
  boostUntil,
  featuredUntil,
  videoDuration,
  focalX,
  focalY,
  mediaWidth,
  mediaHeight,
}: BusinessCardProps) {
  const displayCover =
    coverVideo ||
    coverPhoto ||
    (galleryPhotos && galleryPhotos.length > 0 ? galleryPhotos[0] : null);
  const posterUrl = videoThumbnail || coverPhoto || galleryPhotos?.[0] || undefined;
  const status = getBusinessStatus(boostUntil, featuredUntil);
  const cardDescription = buildBusinessDescription(
    category,
    subcategory,
    businessType,
    _description
  );

  return (
    <PosterCardShell
      href={`/mzansi-business/${id}`}
      title={businessName}
      description={cardDescription}
      location={city || null}
      mediaUrl={displayCover}
      posterUrl={posterUrl}
      mediaAlt={businessName}
      logoUrl={logoUrl}
      statusLabel={status?.label ?? null}
      statusClassName={status?.className}
      statusVariant="ribbon"
      accentClassName="hover:border-brand-blue/55"
      trustLevel={trustLevel}
      videoDuration={videoDuration}
      focalX={focalX}
      focalY={focalY}
      mediaWidth={mediaWidth}
      mediaHeight={mediaHeight}
      fallback={
        <div className="flex h-full w-full items-center justify-center text-brand-blue/35">
          <Store className="h-16 w-16" />
        </div>
      }
    />
  );
}
