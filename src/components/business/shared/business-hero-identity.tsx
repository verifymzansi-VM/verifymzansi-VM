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
}

export function BusinessHeroIdentity({
  business,
  variant = "below",
  hideCallCta = false,
  primaryCtaLabel,
}: BusinessHeroIdentityProps) {
  const businessType = business.business_type as BusinessType;
  const businessCategory = business.category as BusinessCategory;

  return (
    <div className="relative z-10 mx-auto flex w-full flex-col items-center gap-6 px-6 pb-6 pt-4 text-center md:flex-row md:items-end md:gap-8 md:text-left">
      {/* Logo */}
      <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-2xl border bg-white p-2 shadow-xl dark:bg-warm-900">
        {business.logo_url ? (
          <Image
            src={normalizeMediaUrl(business.logo_url)}
            alt={`${business.business_name} Logo`}
            width={128}
            height={128}
            className="h-full w-full rounded-xl object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-xl bg-muted">
            <Store className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Identity */}
      <div className="flex-1 pt-12 md:pt-0">
        <h1
          className={`font-display text-2xl font-bold md:text-3xl ${
            variant === "overlay" ? "text-white drop-shadow-lg" : "text-foreground"
          }`}
        >
          {business.business_name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 md:justify-start">
          <Badge
            variant="outline"
            className={`text-xs ${variant === "overlay" ? "border-white/40 text-white" : ""}`}
          >
            {BUSINESS_TYPE_LABELS[businessType]}
          </Badge>
          <Badge
            variant="secondary"
            className={`text-xs ${variant === "overlay" ? "bg-white/20 text-white" : ""}`}
          >
            {BUSINESS_CATEGORY_LABELS[businessCategory]}
          </Badge>
          {business.store_number && business.store_number !== "N/A" && (
            <span
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${
                variant === "overlay" ? "bg-white/20 text-white" : "bg-muted text-foreground"
              }`}
            >
              <Store className="h-4 w-4 text-brand-blue" />
              Shop {business.store_number}
            </span>
          )}
          {(business.location_province || business.location_city) && (
            <span
              className={`flex items-center gap-1 text-sm ${
                variant === "overlay" ? "text-white/80" : "text-muted-foreground"
              }`}
            >
              <MapPin className="h-4 w-4" />
              {[business.location_city, business.location_province].filter(Boolean).join(", ")}
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
