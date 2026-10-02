"use client";

import { MessageSquare } from "lucide-react";

import { ContentContactActions } from "@/components/listings/content-contact-actions";
import { listingContactConfig } from "@/components/listings/contact-action-configs";

/* ─────────────────────────────────────────────────────────── */

interface ListingContactActionsProps {
  listingId: string;
  listingTitle?: string;
  contactMethods?: string[] | null;
  /** Owner's phone from contact_methods if available */
  ownerPhone?: string | null;
  /** Owner's whatsapp from contact_methods if available */
  ownerWhatsapp?: string | null;
  /** @deprecated Use ownerPhone instead */
  sellerPhone?: string | null;
  /** @deprecated Use ownerWhatsapp instead */
  sellerWhatsapp?: string | null;
}

export function ListingContactActions({
  listingId,
  listingTitle,
  contactMethods,
  ownerPhone,
  ownerWhatsapp,
  sellerPhone,
  sellerWhatsapp,
}: ListingContactActionsProps) {
  const contactPhone = ownerPhone ?? sellerPhone;
  const contactWhatsapp = ownerWhatsapp ?? sellerWhatsapp;
  return (
    <ContentContactActions
      phone={contactPhone}
      whatsapp={contactWhatsapp}
      showPhoneButton={true}
      showMessageButton={
        contactMethods == null ||
        contactMethods.some((method) => ["form", "in_app"].includes(method))
      }
      messageIcon={MessageSquare}
      config={listingContactConfig(listingId, listingTitle)}
    />
  );
}
