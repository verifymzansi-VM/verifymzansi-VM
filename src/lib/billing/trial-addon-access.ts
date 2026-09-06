import type { SupabaseClient } from "@supabase/supabase-js";

export async function getTrialAddonBlock(
  admin: SupabaseClient,
  contentId: string
): Promise<{ error: string; status: number } | null> {
  const { data, error } = await admin
    .from("intro_trial_claims")
    .select("id")
    .eq("content_id", contentId)
    .is("converted_at", null)
    .maybeSingle();
  if (error) return { error: "Unable to verify post funding", status: 503 };
  if (data)
    return {
      error:
        "Renew this introductory post using your paid plan before purchasing premium placement.",
      status: 403,
    };
  return null;
}
