"use client";

import { MessageCircle } from "lucide-react";

import { ContentContactActions } from "@/components/listings/content-contact-actions";

interface PromotionContactActionsProps {
  promotionId: string;
  contactMethods: string[];
  advertiserPhone?: string | null;
  advertiserWhatsapp?: string | null;
}

export function PromotionContactActions({
  promotionId,
  contactMethods,
  advertiserPhone,
  advertiserWhatsapp,
}: PromotionContactActionsProps) {
  return (
    <ContentContactActions
      phone={advertiserPhone}
      whatsapp={contactMethods.includes("whatsapp") ? advertiserWhatsapp : null}
      showPhoneButton={contactMethods.includes("call")}
      showMessageButton={contactMethods.includes("form") || contactMethods.includes("in_app")}
      messageIcon={MessageCircle}
      config={{
        targetId: promotionId,
        sharePath: `/tourism-events/${promotionId}`,
        shareTitle: "Check out this event on VerifyMzansi",
        contactPayloadKey: "promotionId",
        contactErrorFallback: "Failed to send enquiry",
        reportTargetType: "promotion",
        reportTitle: "Report Event",
        reportPlaceholder: "Please describe what's wrong with this event...",
        reportSuccessCopy: "Thank you. Our team will review this event.",
        reportOptions: [
          { value: "scam", label: "Scam or fraud" },
          { value: "misleading", label: "Misleading event" },
          { value: "expired", label: "Already expired" },
          { value: "harassment", label: "Harassment" },
          { value: "spam", label: "Spam" },
          { value: "other", label: "Other" },
        ],
        messageTitle: "Send a Message",
        messageDescription:
          "Your enquiry is saved in the advertiser’s inbox with your reply details.",
        messagePlaceholder: "Hi, I'm interested in this event...",
        messageSubmitLabel: "Send message",
        messageSuccessCopy: "Your enquiry is in the advertiser’s inbox with your reply details.",
      }}
    />
  );
}
