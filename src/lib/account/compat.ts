import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountVerificationStatus, CompatibleUserRole, UserRole } from "@/types/enums";

export const ACCOUNT_PROFILE_TABLE = "account_profiles";
export const ACCOUNT_PROFILE_WRITE_TABLE = ACCOUNT_PROFILE_TABLE;
export const ACCOUNT_PROFILE_NOT_FOUND_ERROR = "Account profile not found";

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
type ProbeResult = {
  error?: {
    code?: string | null;
    message?: string | null;
  } | null;
};

const ownerColumnCache = new Map<OwnerCompatibleTable, Promise<OwnerColumn>>();

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

export function isCompatibleUserRole(role: string | null | undefined): role is CompatibleUserRole {
  return normalizeUserRole(role) !== null;
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

function isMissingOwnerColumnError(error: ProbeResult["error"], ownerColumn: OwnerColumn): boolean {
  if (!error) {
    return false;
  }

  if (error.code === "42703") {
    return true;
  }

  const message = error.message?.toLowerCase() ?? "";
  return message.includes(ownerColumn);
}

async function runOwnerColumnProbe(
  client: MinimalSupabaseClient,
  table: OwnerCompatibleTable,
  ownerColumn: OwnerColumn
): Promise<ProbeResult> {
  const builder = client.from(table).select(`id, ${ownerColumn}`) as unknown as {
    limit?: (count: number) => Promise<ProbeResult>;
  };

  if (typeof builder.limit === "function") {
    return builder.limit(1);
  }

  // Lightweight test doubles do not always expose the full query-builder surface.
  return { error: null };
}

async function detectOwnerColumn(
  client: MinimalSupabaseClient,
  table: OwnerCompatibleTable
): Promise<OwnerColumn> {
  const ownerProbe = await runOwnerColumnProbe(client, table, "owner_id");
  if (!ownerProbe.error) {
    return "owner_id";
  }

  if (!isMissingOwnerColumnError(ownerProbe.error, "owner_id")) {
    throw new Error(ownerProbe.error.message || `Failed to probe owner_id for ${table}`);
  }

  const sellerProbe = await runOwnerColumnProbe(client, table, "seller_id");
  if (!sellerProbe.error) {
    return "seller_id";
  }

  if (!isMissingOwnerColumnError(sellerProbe.error, "seller_id")) {
    throw new Error(sellerProbe.error.message || `Failed to probe seller_id for ${table}`);
  }

  throw new Error(`${table} is missing both owner_id and seller_id columns`);
}

export async function getOwnerColumn(
  client: MinimalSupabaseClient,
  table: OwnerCompatibleTable,
  options: { useCache?: boolean } = {}
): Promise<OwnerColumn> {
  const useCache = options.useCache ?? true;

  if (!useCache) {
    return detectOwnerColumn(client, table);
  }

  const cached = ownerColumnCache.get(table);
  if (cached) {
    return cached;
  }

  const probe = detectOwnerColumn(client, table).catch((error) => {
    ownerColumnCache.delete(table);
    throw error;
  });

  ownerColumnCache.set(table, probe);
  return probe;
}

export function withOwnerColumn(selectClause: string, ownerColumn: OwnerColumn): string {
  if (ownerColumn === "owner_id") {
    return selectClause;
  }

  return selectClause.replace(/\bowner_id\b/g, "seller_id");
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

export function withOwnerField<T extends Record<string, unknown>>(
  payload: T,
  ownerColumn: OwnerColumn,
  ownerId: string
): T & { owner_id?: string; seller_id?: string } {
  const nextPayload = { ...payload } as Record<string, unknown>;
  delete nextPayload.owner_id;
  delete nextPayload.seller_id;
  nextPayload[ownerColumn] = ownerId;
  return nextPayload as T & { owner_id?: string; seller_id?: string };
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

export function resetOwnerColumnCacheForTesting(): void {
  ownerColumnCache.clear();
}
