"use client";

import { MessageSquare } from "lucide-react";

import { ContentContactActions } from "@/components/listings/content-contact-actions";

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
      config={{
        targetId: listingId,
        sharePath: `/listing/${listingId}`,
        shareTitle: listingTitle || "this listing on VerifyMzansi",
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
        messageDescription: "Your enquiry is saved in the seller’s inbox with your reply details.",
        messagePlaceholder: "Hi, I'm interested in this listing...",
        messageSubmitLabel: "Send",
        messageSuccessCopy:
          "Your enquiry is in the seller’s inbox. They can reply using the contact details you provided.",
      }}
    />
  );
}
