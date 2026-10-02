"use client";

import { MessageCircle } from "lucide-react";

import { ContentContactActions } from "@/components/listings/content-contact-actions";
import { promotionContactConfig } from "@/components/listings/contact-action-configs";

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
      config={promotionContactConfig(promotionId)}
    />
  );
}
