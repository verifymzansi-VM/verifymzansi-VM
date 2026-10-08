"use client";

import { MessageSquare } from "lucide-react";

import { ContentContactActions } from "@/components/listings/content-contact-actions";
import { listingContactConfig } from "@/components/listings/contact-action-configs";

/* ─────────────────────────────────────────────────────────── */

interface ListingContactActionsProps {
  listingId: string;
  listingTitle?: string;
  /** Owner's phone from contact_methods if available */
  ownerPhone?: string | null;
  /** Owner's whatsapp from contact_methods if available */
  ownerWhatsapp?: string | null;
  /** @deprecated Use ownerPhone instead */
  sellerPhone?: string | null;
  /** @deprecated Use ownerWhatsapp instead */
  sellerWhatsapp?: string | null;
  /** Which methods any visitor can reveal (numbers aren't in the page). */
  revealable?: { phone: boolean; whatsapp: boolean } | null;
}

export function ListingContactActions({
  listingId,
  listingTitle,
  ownerPhone,
  ownerWhatsapp,
  sellerPhone,
  sellerWhatsapp,
  revealable,
}: ListingContactActionsProps) {
  const contactPhone = ownerPhone ?? sellerPhone;
  const contactWhatsapp = ownerWhatsapp ?? sellerWhatsapp;
  return (
    <ContentContactActions
      phone={contactPhone}
      whatsapp={contactWhatsapp}
      showPhoneButton={true}
      // Private enquiries are always on for Market listings.
      showMessageButton={true}
      messageIcon={MessageSquare}
      revealable={revealable}
      config={listingContactConfig(listingId, listingTitle)}
    />
  );
}
