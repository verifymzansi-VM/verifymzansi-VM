import type { SupabaseClient } from "@supabase/supabase-js";

import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import type { MarketplaceArea } from "@/types/enums";

export const POST_TERMS_VERSION = "post-terms-2026-05-15";

type ConsentSupabase = Pick<SupabaseClient, "from">;

export function getFreePostExpiryDate(from = new Date()): Date {
  return new Date(from.getTime() + FREE_POST_CONFIG.durationDays * 24 * 60 * 60 * 1000);
}

export function getFreePostExpiryIso(from = new Date()): string {
  return getFreePostExpiryDate(from).toISOString();
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
