import type { SupabaseClient } from "@supabase/supabase-js";

import { applyOwnerFilter, getOwnerColumn, withOwnerColumn } from "@/lib/account/compat";

type BusinessLookupClient = Pick<SupabaseClient, "from">;

export async function userOwnsBusiness(
  client: BusinessLookupClient,
  userId: string,
  businessId: string | null | undefined
): Promise<boolean> {
  if (!businessId) {
    return true;
  }

  const ownerColumn = await getOwnerColumn(client as never, "businesses");
  const { data, error } = await applyOwnerFilter(
    client
      .from("businesses")
      .select(withOwnerColumn("id, owner_id", ownerColumn))
      .eq("id", businessId),
    ownerColumn,
    userId
  ).maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to validate linked business ownership");
  }

  return Boolean(data);
}
