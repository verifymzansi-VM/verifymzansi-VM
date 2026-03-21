import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns `true` if the user has a phone number on their account profile.
 * Used as a server-side guard on content-creation API routes to prevent
 * users from bypassing the client-side complete-profile gate.
 */
export async function hasPhoneNumber(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from(ACCOUNT_PROFILE_TABLE)
    .select("phone")
    .eq("user_id", userId)
    .maybeSingle();

  return Boolean(data?.phone);
}
