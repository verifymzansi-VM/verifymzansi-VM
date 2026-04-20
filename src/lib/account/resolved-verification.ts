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
  gps_mismatch?: { province: boolean; city: boolean } | null;
  gps_resolved_province?: string | null;
  gps_resolved_city?: string | null;
  gps_confidence?: string | null;
};

type VerificationStepDbRow = Omit<
  VerificationStepRow,
  "gps_mismatch" | "gps_resolved_province" | "gps_resolved_city" | "gps_confidence"
> & {
  metadata?: Record<string, unknown> | null;
};

function readStringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readGpsMismatch(value: unknown): { province: boolean; city: boolean } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const mismatch = value as Record<string, unknown>;
  const province = mismatch.province;
  const city = mismatch.city;

  if (typeof province !== "boolean" || typeof city !== "boolean") {
    return null;
  }

  return { province, city };
}

function mapVerificationStepRow(step: VerificationStepDbRow): VerificationStepRow {
  const metadata = step.metadata ?? null;

  return {
    step_type: step.step_type,
    status: step.status,
    reviewed_at: step.reviewed_at,
    reason_code: step.reason_code,
    reason_note: step.reason_note,
    risk_level: step.risk_level,
    submitted_at: step.submitted_at,
    location_method: step.location_method,
    location_province: step.location_province,
    location_city: step.location_city,
    location_town: step.location_town,
    gps_mismatch: readGpsMismatch(metadata?.mismatch),
    gps_resolved_province: readStringField(metadata?.gps_province),
    gps_resolved_city: readStringField(metadata?.gps_city),
    gps_confidence: readStringField(metadata?.confidence),
  };
}

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
        "step_type, status, reviewed_at, reason_code, reason_note, risk_level, submitted_at, location_method, location_province, location_city, location_town, metadata"
      )
      .eq("user_id", userId);

    steps = ((stepsResult.data as VerificationStepDbRow[] | null) ?? []).map(
      mapVerificationStepRow
    );
  }

  const summary = summarizeVerification(profile?.account_verification_status, steps);

  return {
    profile,
    steps,
    ...summary,
  };
}
