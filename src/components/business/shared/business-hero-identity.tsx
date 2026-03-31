"use client";

import Image from "next/image";
import { MapPin, Phone, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import {
  BUSINESS_CATEGORY_LABELS,
  BUSINESS_TYPE_LABELS,
  type BusinessCategory,
  type BusinessType,
} from "@/types/enums";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

interface BusinessHeroIdentityProps {
  business: BusinessDetailRecord;
  /** "overlay" places text over cover, "below" places text below cover. */
  variant?: "overlay" | "below";
  /** Hide the Call CTA (e.g. cinematic layout with sticky bar). */
  hideCallCta?: boolean;
  /** Show a category-specific CTA label instead of generic "Call". */
  primaryCtaLabel?: string;
  /** Compact mode: smaller logo, hidden badges on mobile for media-first layouts. */
  compact?: boolean;
}

export function BusinessHeroIdentity({
  business,
  variant = "below",
  hideCallCta = false,
  primaryCtaLabel,
  compact = false,
}: BusinessHeroIdentityProps) {
  const businessType = business.business_type as BusinessType;
  const businessCategory = business.category as BusinessCategory;

  return (
    <div
      className={`relative z-10 mx-auto flex w-full flex-row items-center gap-3 px-4 text-left ${compact ? "pb-3 pt-2 md:gap-3" : "pb-4 pt-3 md:gap-4"}`}
    >
      {/* Logo */}
      <div
        className={`flex-shrink-0 overflow-hidden rounded-xl border bg-white p-0.5 dark:bg-warm-900 ${compact ? "h-8 w-8" : "h-12 w-12 p-1"}`}
      >
        {business.logo_url ? (
          <Image
            src={normalizeMediaUrl(business.logo_url)}
            alt={`${business.business_name} Logo`}
            width={48}
            height={48}
            className="h-full w-full rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-lg bg-muted">
            <Store className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Identity */}
      <div className="min-w-0 flex-1">
        <h1
          className={`font-display text-lg font-bold md:text-2xl ${
            variant === "overlay" ? "text-white drop-shadow-lg" : "text-foreground"
          }`}
        >
          {business.business_name}
        </h1>
        <div
          className={`mt-1.5 flex flex-wrap items-center gap-1.5 ${compact ? "hidden md:flex" : ""}`}
        >
          <Badge
            variant="outline"
            className={`text-[10px] ${variant === "overlay" ? "border-white/40 text-white" : ""}`}
          >
            {BUSINESS_TYPE_LABELS[businessType]}
          </Badge>
          <Badge
            variant="secondary"
            className={`text-[10px] ${variant === "overlay" ? "bg-white/20 text-white" : ""}`}
          >
            {BUSINESS_CATEGORY_LABELS[businessCategory]}
          </Badge>
          {business.store_number && business.store_number !== "N/A" && (
            <span
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                variant === "overlay" ? "bg-white/20 text-white" : "bg-muted text-foreground"
              }`}
            >
              <Store className="h-3 w-3 text-brand-blue" />
              Shop {business.store_number}
            </span>
          )}
          {(business.location_province || business.location_city) && (
            <span
              className={`flex items-center gap-1 text-xs ${
                variant === "overlay" ? "text-white/80" : "text-muted-foreground"
              }`}
            >
              <MapPin className="h-3 w-3" />
              {[business.location_town, business.location_city, business.location_province]
                .filter(Boolean)
                .join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* CTA */}
      {!hideCallCta && business.phone && (
        <div className="mb-2 hidden gap-3 self-end md:flex">
          <Button asChild className="gap-2 shrink-0 shadow-md">
            <a href={`tel:${business.phone}`}>
              <Phone className="h-4 w-4" /> {primaryCtaLabel ?? "Call"}
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
