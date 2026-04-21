import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_PROFILE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { createLogger } from "@/lib/utils/logger";
import {
  summarizeVerification,
  type VerificationSummary,
} from "@/lib/account/verification-summary";

const log = createLogger("ResolvedVerification");

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

type PendingArtifactRow = {
  step_type?: string | null;
  status?: string | null;
  created_at?: string | null;
};

const RECOVERABLE_PENDING_ARTIFACT_STEPS = ["id_doc", "selfie"] as const;
const VERIFICATION_STEP_ORDER = ["phone", "id_doc", "selfie", "location"] as const;

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

function normalizeRecoverablePendingArtifactStep(
  stepType: string | null | undefined
): (typeof RECOVERABLE_PENDING_ARTIFACT_STEPS)[number] | null {
  switch (stepType) {
    case "id_doc":
    case "selfie":
      return stepType;
    default:
      return null;
  }
}

function mergeRecoveredPendingArtifactSteps(
  steps: VerificationStepRow[],
  pendingArtifacts: PendingArtifactRow[]
): { steps: VerificationStepRow[]; recoveredStepTypes: Array<"id_doc" | "selfie"> } {
  const existingSteps = new Set(
    steps
      .map((step) => normalizeRecoverablePendingArtifactStep(step.step_type))
      .filter((stepType): stepType is "id_doc" | "selfie" => stepType !== null)
  );
  const recoveredStepTypes: Array<"id_doc" | "selfie"> = [];

  const recoveredSteps = pendingArtifacts.flatMap((artifact) => {
    const stepType = normalizeRecoverablePendingArtifactStep(artifact.step_type);

    if (!stepType || artifact.status !== "pending" || existingSteps.has(stepType)) {
      return [];
    }

    existingSteps.add(stepType);
    recoveredStepTypes.push(stepType);

    return [
      {
        step_type: stepType,
        status: "pending",
        submitted_at: artifact.created_at ?? null,
      } satisfies VerificationStepRow,
    ];
  });

  return {
    steps: [...steps, ...recoveredSteps].sort((left, right) => {
      const leftIndex = VERIFICATION_STEP_ORDER.indexOf(
        (left.step_type as (typeof VERIFICATION_STEP_ORDER)[number] | undefined) ?? "phone"
      );
      const rightIndex = VERIFICATION_STEP_ORDER.indexOf(
        (right.step_type as (typeof VERIFICATION_STEP_ORDER)[number] | undefined) ?? "phone"
      );

      return leftIndex - rightIndex;
    }),
    recoveredStepTypes,
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

    const pendingArtifactsResult = await client
      .from("kyc_artifacts")
      .select("step_type, status, created_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .in("step_type", [...RECOVERABLE_PENDING_ARTIFACT_STEPS]);

    const recoveredPendingSteps = mergeRecoveredPendingArtifactSteps(
      steps,
      (pendingArtifactsResult.data as PendingArtifactRow[] | null) ?? []
    );

    steps = recoveredPendingSteps.steps;

    if (recoveredPendingSteps.recoveredStepTypes.length > 0) {
      log.info("Recovered pending verification steps from artifacts", {
        userId,
        recoveredStepTypes: recoveredPendingSteps.recoveredStepTypes,
      });
    }
  }

  const summary = summarizeVerification(profile?.account_verification_status, steps);

  return {
    profile,
    steps,
    ...summary,
  };
}
