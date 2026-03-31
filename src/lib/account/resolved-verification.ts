import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_PROFILE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import {
  summarizeVerification,
  type VerificationSummary,
} from "@/lib/account/verification-summary";

type VerificationClient = Pick<SupabaseClient, "from">;

type ProfileRow = {
  id?: string;
  account_verification_status?: string | null;
} | null;

type VerificationStepRow = {
  step_type?: string | null;
  status?: string | null;
  reviewed_at?: string | null;
  reason_code?: string | null;
  reason_note?: string | null;
  risk_level?: string | null;
  submitted_at?: string | null;
  location_method?: string | null;
  location_province?: string | null;
  location_city?: string | null;
  location_town?: string | null;
};

export interface ResolvedAccountVerification extends VerificationSummary {
  profile: ProfileRow;
  steps: VerificationStepRow[];
}

export async function resolveAccountVerification(
  client: VerificationClient,
  userId: string,
  options: { includeStepsWhenVerified?: boolean } = {}
): Promise<ResolvedAccountVerification> {
  const profileResult = await client
    .from(ACCOUNT_PROFILE_TABLE)
    .select("id, account_verification_status")
    .eq("user_id", userId)
    .maybeSingle();

  const profile = (profileResult.data ?? null) as ProfileRow;
  const shouldLoadSteps =
    options.includeStepsWhenVerified === true ||
    readAccountVerificationStatus(profile) !== "verified";

  let steps: VerificationStepRow[] = [];

  if (shouldLoadSteps) {
    const stepsResult = await client
      .from("verification_steps")
      .select(
        "step_type, status, reviewed_at, reason_code, reason_note, risk_level, submitted_at, location_method, location_province, location_city, location_town"
      )
      .eq("user_id", userId);

    steps = (stepsResult.data as VerificationStepRow[] | null) ?? [];
  }

  const summary = summarizeVerification(profile?.account_verification_status, steps);

  return {
    profile,
    steps,
    ...summary,
  };
}
