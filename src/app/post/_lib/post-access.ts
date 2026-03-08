import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { AREA_LABELS, type MarketplaceArea, type SellerVerificationStatus } from "@/types/enums";

export function isVerifiedSeller(
  status: SellerVerificationStatus | null | undefined
): status is "verified" {
  return status === "verified";
}

export function buildVerificationRedirectUrl(returnUrl: string): string {
  const safeReturnUrl = sanitizeReturnUrl(returnUrl);
  return `/verification?returnUrl=${encodeURIComponent(safeReturnUrl)}`;
}

export function buildPostCategoryHref(
  targetHref: string,
  status: SellerVerificationStatus | null | undefined
): string {
  const safeTargetHref = sanitizeReturnUrl(targetHref);
  return isVerifiedSeller(status) ? safeTargetHref : buildVerificationRedirectUrl(safeTargetHref);
}

export function createVerificationRequiredPayload(area: MarketplaceArea) {
  return {
    error: "Verification required",
    code: "verification_required" as const,
    reason: `Complete verification before you can start posting in ${AREA_LABELS[area]}.`,
  };
}
