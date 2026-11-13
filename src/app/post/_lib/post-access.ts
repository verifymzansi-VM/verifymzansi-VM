import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import type { AccountVerificationStatus } from "@/types/enums";

export function isVerifiedMember(
  status: AccountVerificationStatus | null | undefined
): status is "verified" {
  return status === "verified";
}

export function buildVerificationRedirectUrl(returnUrl: string): string {
  const safeReturnUrl = sanitizeReturnUrl(returnUrl);
  return `/verification?returnUrl=${encodeURIComponent(safeReturnUrl)}`;
}

export function buildPostCategoryHref(
  targetHref: string,
  status: AccountVerificationStatus | null | undefined
): string {
  const safeTargetHref = sanitizeReturnUrl(targetHref);
  return isVerifiedMember(status) ? safeTargetHref : buildVerificationRedirectUrl(safeTargetHref);
}
