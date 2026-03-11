import type { AccountVerificationStatus, CompatibleUserRole, UserRole } from "@/types/enums";

export const LEGACY_ACCOUNT_PROFILE_TABLE = "seller_profiles";
export const ACCOUNT_PROFILE_TABLE = "account_profiles";
export const ACCOUNT_PROFILE_WRITE_TABLE = LEGACY_ACCOUNT_PROFILE_TABLE;
export const ACCOUNT_PROFILE_NOT_FOUND_ERROR = "Account profile not found";

export function normalizeUserRole(role: string | null | undefined): UserRole | null {
  const normalized = role?.trim().toLowerCase();

  switch (normalized) {
    case "seller":
    case "member":
      return "member";
    case "moderator":
      return "moderator";
    case "admin":
      return "admin";
    default:
      return null;
  }
}

export function isCompatibleUserRole(role: string | null | undefined): role is CompatibleUserRole {
  return normalizeUserRole(role) !== null || role === "seller";
}

export function normalizeAccountVerificationStatus(
  status: string | null | undefined
): AccountVerificationStatus | null {
  switch (status) {
    case "incomplete":
    case "pending_review":
    case "verified":
    case "rejected":
      return status;
    default:
      return null;
  }
}

export function readAccountVerificationStatus(
  profile:
    | {
        account_verification_status?: string | null;
        seller_verification_status?: string | null;
      }
    | null
    | undefined
): AccountVerificationStatus | null {
  return normalizeAccountVerificationStatus(
    profile?.account_verification_status ?? profile?.seller_verification_status ?? null
  );
}

export function readOwnerId(
  record:
    | {
        owner_id?: string | null;
        seller_id?: string | null;
      }
    | null
    | undefined
): string | null {
  return record?.owner_id ?? record?.seller_id ?? null;
}
