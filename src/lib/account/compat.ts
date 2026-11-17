import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountVerificationStatus, UserRole } from "@/types/enums";

export const ACCOUNT_PROFILE_TABLE = "account_profiles";
export const ACCOUNT_PROFILE_WRITE_TABLE = ACCOUNT_PROFILE_TABLE;

export const OWNER_COMPAT_TABLES = [
  "listings",
  "businesses",
  "promotions",
  "leads",
  "contact_events",
] as const;

export type OwnerCompatibleTable = (typeof OWNER_COMPAT_TABLES)[number];
export type OwnerColumn = "owner_id" | "seller_id";

type MinimalSupabaseClient = Pick<SupabaseClient, "from">;
type OwnerCompatibleRecord = {
  owner_id?: string | null;
  seller_id?: string | null;
};

export function normalizeUserRole(role: string | null | undefined): UserRole | null {
  const normalized = role?.trim().toLowerCase();

  switch (normalized) {
    case "member":
      return "member";
    case "moderator":
      return "moderator";
    case "governance_controller":
      return "governance_controller";
    case "admin":
      return "admin";
    default:
      return null;
  }
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
      }
    | null
    | undefined
): AccountVerificationStatus | null {
  return normalizeAccountVerificationStatus(profile?.account_verification_status ?? null);
}

export function readOwnerId(record: unknown): string | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const ownerRecord = record as OwnerCompatibleRecord;
  return ownerRecord.owner_id ?? ownerRecord.seller_id ?? null;
}

/** Foundation posts and contacts are always owned through owner_id. */
export async function getOwnerColumn(
  _client: MinimalSupabaseClient,
  _table: OwnerCompatibleTable
): Promise<OwnerColumn> {
  return "owner_id";
}

export function applyOwnerFilter<T>(query: T, ownerColumn: OwnerColumn, ownerId: string): T {
  const maybeQuery = query as T & {
    eq?: (column: string, value: unknown) => unknown;
  };

  if (typeof maybeQuery.eq !== "function") {
    return query;
  }

  return maybeQuery.eq(ownerColumn, ownerId) as T;
}

export function normalizeOwnerRecord<T extends object>(record: T): T & { owner_id: string | null } {
  return {
    ...record,
    owner_id: readOwnerId(record),
  };
}

export function normalizeOwnerRecords<T extends object>(
  records: T[] | null | undefined
): Array<T & { owner_id: string | null }> {
  return (records ?? []).map((record) => normalizeOwnerRecord(record));
}
