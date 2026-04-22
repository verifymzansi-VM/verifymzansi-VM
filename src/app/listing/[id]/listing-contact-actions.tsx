"use client";

import { MessageSquare } from "lucide-react";

import { ContentContactActions } from "@/components/listings/content-contact-actions";

/* ─────────────────────────────────────────────────────────── */

interface ListingContactActionsProps {
  listingId: string;
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
      showMessageButton={true}
      messageIcon={MessageSquare}
      config={{
        targetId: listingId,
        sharePath: `/listing/${listingId}`,
        shareTitle: "Check out this listing on VerifyMzansi",
        contactPayloadKey: "listingId",
        contactErrorFallback: "Failed to send message",
        reportTargetType: "listing",
        reportTitle: "Report Listing",
        reportPlaceholder: "Please describe what's wrong with this listing...",
        reportSuccessCopy: "Thank you. Our team will review this listing.",
        reportOptions: [
          { value: "scam", label: "Scam or fraud" },
          { value: "fake_listing", label: "Fake listing" },
          { value: "prohibited_item", label: "Prohibited item" },
          { value: "harassment", label: "Harassment" },
          { value: "impersonation", label: "Impersonation" },
          { value: "spam", label: "Spam" },
          { value: "other", label: "Other" },
        ],
        messageTitle: "Send a Message",
        messageDescription:
          "Your message will be sent to the member. They will see your email if you are logged in.",
        messagePlaceholder: "Hi, I'm interested in this listing...",
        messageSubmitLabel: "Send",
        messageSuccessCopy: "The member has been notified.",
      }}
    />
  );
}
