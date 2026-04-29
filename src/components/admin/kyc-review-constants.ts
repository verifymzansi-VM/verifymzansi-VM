export const KYC_REVIEW_REASON_CODES = [
  { value: "blurry_image", label: "Image too blurry to verify" },
  { value: "mismatch", label: "Selfie does not match ID photo" },
  { value: "expired_document", label: "ID document is expired" },
  { value: "incomplete_info", label: "Missing or unreadable fields" },
  { value: "fraudulent", label: "Suspected fraudulent document" },
  { value: "wrong_document_type", label: "Uploaded wrong document type" },
  { value: "not_sa_document", label: "Document is not South African" },
  { value: "other", label: "Other (provide note)" },
] as const;

export function getKycZoomWidthClass(zoomLevel: number): string {
  if (zoomLevel <= 0.5) return "w-1/2";
  if (zoomLevel <= 0.75) return "w-3/4";
  if (zoomLevel <= 1) return "w-full";
  if (zoomLevel <= 1.25) return "w-[125%]";
  if (zoomLevel <= 1.5) return "w-[150%]";
  if (zoomLevel <= 1.75) return "w-[175%]";
  if (zoomLevel <= 2) return "w-[200%]";
  if (zoomLevel <= 2.25) return "w-[225%]";
  if (zoomLevel <= 2.5) return "w-[250%]";
  if (zoomLevel <= 2.75) return "w-[275%]";
  return "w-[300%]";
}
