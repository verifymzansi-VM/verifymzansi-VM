"use client";

import { Store } from "lucide-react";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
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
  boostUntil?: string | null;
  featuredUntil?: string | null;
  serviceAreas?: Record<string, unknown> | null;
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

function buildBusinessDescription(description?: string, city?: string): string | null {
  if (description && city) return `${city} · ${description}`;
  if (city) return city;
  if (description) return description;
  return null;
}

export function BusinessCard({
  id,
  businessName,
  description,
  coverPhoto,
  coverVideo,
  videoThumbnail,
  logoUrl,
  galleryPhotos,
  province: _province,
  city,
  trustLevel = 0,
  boostUntil,
  featuredUntil,
}: BusinessCardProps) {
  const displayCover =
    coverVideo ||
    coverPhoto ||
    (galleryPhotos && galleryPhotos.length > 0 ? galleryPhotos[0] : null);
  const posterUrl = videoThumbnail || coverPhoto || galleryPhotos?.[0] || undefined;
  const status = getBusinessStatus(boostUntil, featuredUntil);
  const cardDescription = buildBusinessDescription(description, city);

  return (
    <PosterCardShell
      href={`/mzansi-business/${id}`}
      title={businessName}
      description={cardDescription}
      mediaUrl={displayCover}
      posterUrl={posterUrl}
      mediaAlt={businessName}
      logoUrl={logoUrl}
      statusLabel={status?.label ?? null}
      statusClassName={status?.className}
      statusVariant="ribbon"
      accentClassName="hover:border-brand-blue/55"
      trustLevel={trustLevel}
      fallback={
        <div className="flex h-full w-full items-center justify-center text-brand-blue/35">
          <Store className="h-16 w-16" />
        </div>
      }
    />
  );
}
