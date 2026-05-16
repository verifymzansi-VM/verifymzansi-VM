import type { SupabaseClient } from "@supabase/supabase-js";

import { FREE_POST_CONFIG, PAID_POST_CONFIG } from "@/lib/constants/pricing";
import type { MarketplaceArea } from "@/types/enums";

export const POST_TERMS_VERSION = "post-terms-2026-05-15";

type ConsentSupabase = Pick<SupabaseClient, "from">;

export function getFreePostExpiryDate(from = new Date()): Date {
  return new Date(from.getTime() + FREE_POST_CONFIG.durationDays * 24 * 60 * 60 * 1000);
}

export function getFreePostExpiryIso(from = new Date()): string {
  return getFreePostExpiryDate(from).toISOString();
}

export function getPaidPostExpiryDate(from = new Date()): Date {
  return new Date(from.getTime() + PAID_POST_CONFIG.durationDays * 24 * 60 * 60 * 1000);
}

export function getPaidPostExpiryIso(from = new Date()): string {
  return getPaidPostExpiryDate(from).toISOString();
}

export function getPostExpiryIso(
  { hasPaidPlan }: { hasPaidPlan: boolean },
  from = new Date()
): string {
  return hasPaidPlan ? getPaidPostExpiryIso(from) : getFreePostExpiryIso(from);
}

export function getPostVisibilityDurationDaysFromStoredExpiry({
  createdAt,
  expiresAt,
}: {
  createdAt: string | null | undefined;
  expiresAt: string | null | undefined;
}): number {
  if (!createdAt || !expiresAt) {
    return PAID_POST_CONFIG.durationDays;
  }

  const createdTime = new Date(createdAt).getTime();
  const expiryTime = new Date(expiresAt).getTime();
  if (!Number.isFinite(createdTime) || !Number.isFinite(expiryTime) || expiryTime <= createdTime) {
    return FREE_POST_CONFIG.durationDays;
  }

  const durationDays = Math.round((expiryTime - createdTime) / (24 * 60 * 60 * 1000));
  const paidThreshold = (FREE_POST_CONFIG.durationDays + PAID_POST_CONFIG.durationDays) / 2;
  return durationDays >= paidThreshold
    ? PAID_POST_CONFIG.durationDays
    : FREE_POST_CONFIG.durationDays;
}

export function getApprovedPostExpiryIso(
  {
    createdAt,
    expiresAt,
  }: {
    createdAt: string | null | undefined;
    expiresAt: string | null | undefined;
  },
  approvedAt = new Date()
): string {
  const durationDays = getPostVisibilityDurationDaysFromStoredExpiry({ createdAt, expiresAt });
  return new Date(approvedAt.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

export function hasAcceptedPostTerms(value: unknown): boolean {
  return value === true;
}

export async function recordPostTermsAcceptance(
  client: ConsentSupabase,
  {
    userId,
    area,
    contentId,
  }: {
    userId: string;
    area: MarketplaceArea;
    contentId: string;
  }
): Promise<void> {
  const consentTable = client.from("consent_records") as unknown as {
    insert?: (
      payload: Record<string, unknown>
    ) => PromiseLike<{ error: { message: string } | null }>;
  };

  if (typeof consentTable.insert !== "function") {
    return;
  }

  const { error } = await consentTable.insert({
    user_id: userId,
    consent_type: "post_creation_terms",
    version: POST_TERMS_VERSION,
    granted: true,
    ip_hash: null,
    metadata: {
      area,
      content_id: contentId,
      free_post_duration_days: FREE_POST_CONFIG.durationDays,
    },
  });

  if (error) {
    throw new Error(error.message);
  }
}
