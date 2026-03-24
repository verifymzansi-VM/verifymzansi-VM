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
  logoUrl,
  title,
  city,
  provinceCode,
  boosted: _boosted,
  featured: _featured,
}: BusinessPreviewCardProps) {
  return (
    <PosterCardShell
      href={href}
      title={title}
      location={`${city}, ${provinceCode}`}
      mediaUrl={imageUrl}
      posterUrl={posterUrl}
      mediaAlt={title}
      logoUrl={logoUrl}
      statusLabel={null}
      statusClassName={undefined}
      accentClassName="hover:border-brand-blue/55"
      fallback={
        <div className="flex h-full w-full items-center justify-center text-brand-blue/35">
          <Store className="h-16 w-16" />
        </div>
      }
    />
  );
}
