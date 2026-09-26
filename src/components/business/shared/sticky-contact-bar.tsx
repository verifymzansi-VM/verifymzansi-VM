"use client";

import { MessageCircle, Phone } from "lucide-react";
import { StickyMobileBar } from "@/components/ui/sticky-mobile-bar";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

interface StickyContactBarProps {
  business: BusinessDetailRecord;
  /** Category-specific CTA label for the primary action. */
  ctaLabel?: string;
}

/**
 * Floating contact bar fixed at the bottom of the screen on mobile.
 * Shows phone + WhatsApp quick-action buttons.
 * Hidden on desktop (lg+) where the sidebar contact card is visible.
 */
export function StickyContactBar({ business, ctaLabel }: StickyContactBarProps) {
  const hasPhone = Boolean(business.phone);
  const hasWhatsApp = Boolean(business.whatsapp);

  if (!hasPhone && !hasWhatsApp) return null;

  return (
    <StickyMobileBar>
      {hasPhone && (
        <a
          href={`tel:${business.phone}`}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-md transition-colors duration-200 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
          {ctaLabel ?? "Call Now"}
        </a>
      )}
      {hasWhatsApp && (
        <a
          href={`https://wa.me/${business.whatsapp!.replace(/\D/g, "")}`}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-brand-green/30 bg-card text-sm font-semibold text-foreground shadow-md transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <MessageCircle className="h-4 w-4 text-brand-green-600" aria-hidden="true" />
          WhatsApp
        </a>
      )}
    </StickyMobileBar>
  );
}
