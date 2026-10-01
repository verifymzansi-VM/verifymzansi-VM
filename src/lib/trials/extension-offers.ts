import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export interface ExtensionOffer {
  id: string;
  target_type: "organisation_trial" | "founding_contract" | "intro_trial_claim";
  target_id: string;
  target_label: string;
  recipient_user_id: string;
  days: number;
  current_ends_at: string;
  proposed_ends_at: string;
  respond_by: string;
}

const COLUMNS =
  "id, target_type, target_id, target_label, recipient_user_id, days, current_ends_at, proposed_ends_at, respond_by";

/**
 * Open offers on this member's own trials and contracts. Programme offers are
 * answered by the programme's current owner on the programme dashboard.
 */
export async function getOpenOffersForUser(userId: string): Promise<ExtensionOffer[]> {
  const { data } = await createAdminClient()
    .from("trial_extension_offers")
    .select(COLUMNS)
    .eq("recipient_user_id", userId)
    .neq("target_type", "organisation_trial")
    .eq("status", "offered")
    .gt("respond_by", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  return (data ?? []) as ExtensionOffer[];
}

/** The open offer on a sponsor programme, shown to all of its administrators. */
export async function getOpenOfferForOrganisation(orgId: string): Promise<ExtensionOffer | null> {
  const { data } = await createAdminClient()
    .from("trial_extension_offers")
    .select(COLUMNS)
    .eq("target_type", "organisation_trial")
    .eq("target_id", orgId)
    .eq("status", "offered")
    .gt("respond_by", new Date().toISOString())
    .maybeSingle();
  return (data as ExtensionOffer | null) ?? null;
}
