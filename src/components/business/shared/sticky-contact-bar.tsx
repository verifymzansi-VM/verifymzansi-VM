"use client";

import { MessageCircle, MessageSquare, Phone } from "lucide-react";
import { StickyMobileBar } from "@/components/ui/sticky-mobile-bar";
import { ContentEnquiryAction } from "@/components/listings/content-enquiry-action";
import type { ContactActionConfig } from "@/components/listings/contact-action-types";
import { contactPhone } from "@/lib/utils/contact-links";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

interface StickyContactBarProps {
  business: BusinessDetailRecord;
  /** Category-specific CTA label for the primary action. */
  ctaLabel?: string;
  /** The business accepts enquiries: without a number, the bar opens the enquiry form. */
  enquiry?: ContactActionConfig | null;
}

/**
 * Floating contact bar fixed at the bottom of the screen on mobile.
 * Shows phone + WhatsApp quick-action buttons; without a number, the enquiry.
 * Hidden on desktop (lg+) where the sidebar contact card is visible.
 */
export function StickyContactBar({ business, ctaLabel, enquiry = null }: StickyContactBarProps) {
  // Normalise to +27… so local "082…" numbers still produce working tel:/wa.me links.
  const phone = contactPhone(business.phone);
  const whatsapp = contactPhone(business.whatsapp);

  // Without numbers in the page (they couldn't be loaded), send visitors to
  // the contact card.
  if (!phone && !whatsapp) {
    const available = business.contact_available;
    if (!available?.phone && !available?.whatsapp) {
      if (!enquiry) return null;
      // No number to show: the bar opens the same enquiry form as the contact card.
      return (
        <StickyMobileBar>
          <ContentEnquiryAction
            config={enquiry}
            renderTrigger={(open) => (
              <button
                type="button"
                onClick={open}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg transition-all duration-200 hover:-translate-y-px active:bg-primary/90"
              >
                <MessageSquare className="h-4 w-4" />
                Send an enquiry
              </button>
            )}
          />
        </StickyMobileBar>
      );
    }
    return (
      <StickyMobileBar>
        <a
          href="#contact"
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg transition-all duration-200 hover:-translate-y-px active:bg-primary/90"
        >
          <Phone className="h-4 w-4" />
          {ctaLabel ?? "Contact"}
        </a>
      </StickyMobileBar>
    );
  }

  return (
    <StickyMobileBar>
      {phone && (
        <a
          href={`tel:${phone}`}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg transition-all duration-200 hover:-translate-y-px active:bg-primary/90"
        >
          <Phone className="h-4 w-4" />
          {ctaLabel ?? "Call Now"}
        </a>
      )}
      {whatsapp && (
        <a
          href={`https://wa.me/${whatsapp.slice(1)}`}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-green-500 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-px active:bg-green-600"
        >
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </a>
      )}
    </StickyMobileBar>
  );
}
