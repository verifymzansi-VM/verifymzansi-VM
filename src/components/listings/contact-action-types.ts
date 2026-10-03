type ReportOption = {
  value: string;
  label: string;
};

export type ContactActionConfig = {
  targetId: string;
  sharePath: string;
  shareTitle: string;
  contactPayloadKey: "listingId" | "promotionId" | "businessId";
  contactErrorFallback: string;
  reportTargetType: "listing" | "promotion" | "business";
  reportTitle: string;
  reportPlaceholder: string;
  reportSuccessCopy: string;
  reportOptions: ReportOption[];
  messageTitle: string;
  messageDescription: string;
  messagePlaceholder: string;
  messageSubmitLabel: string;
  messageSuccessCopy: string;
};
