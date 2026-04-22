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
      showMessageButton={contactMethods.includes("form")}
      messageIcon={MessageCircle}
      config={{
        targetId: promotionId,
        sharePath: `/tourism-events/${promotionId}`,
        shareTitle: "Check out this promotion on VerifyMzansi",
        contactPayloadKey: "promotionId",
        contactErrorFallback: "Failed to send enquiry",
        reportTargetType: "promotion",
        reportTitle: "Report Promotion",
        reportPlaceholder: "Please describe what's wrong with this promotion...",
        reportSuccessCopy: "Thank you. Our team will review this promotion.",
        reportOptions: [
          { value: "scam", label: "Scam or fraud" },
          { value: "misleading", label: "Misleading promotion" },
          { value: "expired", label: "Already expired" },
          { value: "harassment", label: "Harassment" },
          { value: "spam", label: "Spam" },
          { value: "other", label: "Other" },
        ],
        messageTitle: "Send a Message",
        messageDescription:
          "Your message will be sent to the advertiser. They will see your email if you are logged in.",
        messagePlaceholder: "Hi, I'm interested in this promotion...",
        messageSubmitLabel: "Send message",
        messageSuccessCopy: "The advertiser has been notified.",
      }}
    />
  );
}
