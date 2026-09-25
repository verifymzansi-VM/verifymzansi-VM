import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { MarketplaceArea } from "@/types/enums";

/** Result of the `posting_allowance` RPC: active slot capacity for one area. */
export interface PostingAllowance {
  hasPaidPlan: boolean;
  /** Sum of simultaneous active posts across usable slot entitlements. */
  capacity: number;
  activeUsage: number;
  maxPhotos: number;
  maxVideos: number;
  expiresAt: string | null;
  sources: string[];
  boostAllowed: boolean;
}

class PostingAllowanceError extends Error {}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parsePostingAllowance(raw: unknown): PostingAllowance {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    hasPaidPlan: row.hasPaidPlan === true,
    capacity: toNumber(row.capacity, 0),
    activeUsage: toNumber(row.activeUsage, 0),
    maxPhotos: toNumber(row.maxPhotos, 10),
    maxVideos: toNumber(row.maxVideos, 1),
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
    sources: Array.isArray(row.sources) ? row.sources.filter((s) => typeof s === "string") : [],
    boostAllowed: row.boostAllowed === true,
  };
}

/** Server-side slot allowance. Never trust a client-supplied plan or capacity. */
export async function getPostingAllowance(
  userId: string,
  area: MarketplaceArea
): Promise<PostingAllowance> {
  const { data, error } = await createAdminClient().rpc("posting_allowance", {
    p_user: userId,
    p_area: area,
  });
  if (error) throw new PostingAllowanceError(error.message);
  return parsePostingAllowance(data);
}
