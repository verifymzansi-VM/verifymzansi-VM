import type { ContactActionConfig } from "@/components/listings/content-contact-actions";

export function listingContactConfig(
  listingId: string,
  listingTitle?: string
): ContactActionConfig {
  return {
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
  };
}

export function promotionContactConfig(promotionId: string): ContactActionConfig {
  return {
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
    messageDescription: "Your enquiry is saved in the advertiser’s inbox with your reply details.",
    messagePlaceholder: "Hi, I'm interested in this event...",
    messageSubmitLabel: "Send message",
    messageSuccessCopy: "Your enquiry is in the advertiser’s inbox with your reply details.",
  };
}

export function businessContactConfig(
  businessId: string,
  businessName: string,
  sharePath: string
): ContactActionConfig {
  return {
    targetId: businessId,
    sharePath,
    shareTitle: businessName,
    contactPayloadKey: "businessId",
    contactErrorFallback: "Failed to send enquiry",
    reportTargetType: "business",
    reportTitle: "Report profile",
    reportPlaceholder: "Describe the issue with this profile...",
    reportSuccessCopy: "Thank you. Our team will review this profile.",
    reportOptions: [
      { value: "misleading", label: "Inaccurate information" },
      { value: "scam", label: "Scam or fraud" },
      { value: "other", label: "Other" },
    ],
    messageTitle: `Enquire about ${businessName}`,
    messageDescription: "Your enquiry goes to the account holder’s inbox with your reply details.",
    messagePlaceholder: "Hi, I would like to know more...",
    messageSubmitLabel: "Send enquiry",
    messageSuccessCopy:
      "Your enquiry is in the account holder’s inbox. They can reply using the contact details you provided.",
  };
}
