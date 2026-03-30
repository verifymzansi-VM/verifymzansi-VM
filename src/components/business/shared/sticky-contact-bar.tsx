"use client";

import { MessageCircle, Phone } from "lucide-react";
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
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-lg gap-3">
        {hasPhone && (
          <a
            href={`tel:${business.phone}`}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-colors active:bg-primary/90"
          >
            <Phone className="h-4 w-4" />
            {ctaLabel ?? "Call Now"}
          </a>
        )}
        {hasWhatsApp && (
          <a
            href={`https://wa.me/${business.whatsapp!.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 py-3 text-sm font-semibold text-white shadow-lg transition-colors active:bg-green-600"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
