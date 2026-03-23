"use client";

import { Store } from "lucide-react";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
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
}

export function BusinessPreviewCard({
  href,
  imageUrl,
  posterUrl,
  title,
  city,
  provinceCode,
  boosted,
  featured,
}: BusinessPreviewCardProps) {
  const status = featured
    ? {
        label: "Featured",
        className: "bg-brand-gold/95 text-amber-950 border border-amber-300/50",
      }
    : boosted
      ? {
          label: "Boosted",
          className: "bg-brand-blue/95 text-white border border-white/10",
        }
      : null;

  return (
    <PosterCardShell
      href={href}
      title={title}
      location={`${city}, ${provinceCode}`}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      mediaAlt={title}
      statusLabel={status?.label}
      statusClassName={status?.className}
      accentClassName="hover:border-brand-blue/55"
      fallback={
        <div className="flex h-full w-full items-center justify-center text-brand-blue/35">
          <Store className="h-16 w-16" />
        </div>
      }
    />
  );
}
