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
  location_province?: string | null;
  location_city?: string | null;
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
  phone_verified_at?: string | null;
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

type VerificationSessionRow = {
  phone_verified_at?: string | null;
  location_submitted_at?: string | null;
} | null;

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
  const phoneVerifiedAt = readStringField(step.phone_verified_at);

  return {
    step_type: step.step_type,
    status: step.step_type === "phone" && phoneVerifiedAt ? "approved" : step.status,
    reviewed_at: step.reviewed_at,
    reason_code: step.reason_code,
    reason_note: step.reason_note,
    risk_level: step.risk_level,
    submitted_at: step.submitted_at,
    location_method: step.location_method,
    location_province: step.location_province,
    location_city: step.location_city,
    location_town: step.location_town,
    phone_verified_at: step.phone_verified_at,
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
  const stepMap = new Map(steps.map((step) => [step.step_type, step]));
  const recoveredStepTypes: Array<"id_doc" | "selfie"> = [];

  for (const artifact of pendingArtifacts) {
    const stepType = normalizeRecoverablePendingArtifactStep(artifact.step_type);

    if (!stepType || !artifact.status) {
      continue;
    }

    const existingStep = stepMap.get(stepType);
    const recoveredStatus =
      artifact.status === "approved" ||
      artifact.status === "rejected" ||
      artifact.status === "needs_resubmission"
        ? artifact.status
        : artifact.status === "pending"
          ? "pending"
          : null;

    if (!recoveredStatus) {
      continue;
    }

    if (!existingStep) {
      stepMap.set(stepType, {
        step_type: stepType,
        status: recoveredStatus,
        submitted_at: artifact.created_at ?? null,
      });
      recoveredStepTypes.push(stepType);
      continue;
    }

    if (existingStep.status !== recoveredStatus) {
      stepMap.set(stepType, {
        ...existingStep,
        status: recoveredStatus,
        submitted_at: existingStep.submitted_at ?? artifact.created_at ?? null,
      });
      recoveredStepTypes.push(stepType);
    }
  }

  return {
    steps: [...stepMap.values()].sort((left, right) => {
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

function latestArtifactByStep(artifacts: PendingArtifactRow[]): PendingArtifactRow[] {
  const latest = new Map<"id_doc" | "selfie", PendingArtifactRow>();

  for (const artifact of artifacts) {
    const stepType = normalizeRecoverablePendingArtifactStep(artifact.step_type);
    if (!stepType) {
      continue;
    }

    const status = artifact.status;
    if (
      status !== "pending" &&
      status !== "approved" &&
      status !== "rejected" &&
      status !== "needs_resubmission"
    ) {
      continue;
    }

    const current = latest.get(stepType);
    const artifactTime = Date.parse(artifact.created_at ?? "");
    const currentTime = Date.parse(current?.created_at ?? "");

    if (!current || Number.isNaN(currentTime) || artifactTime >= currentTime) {
      latest.set(stepType, artifact);
    }
  }

  return [...latest.values()];
}

function sortVerificationSteps(steps: VerificationStepRow[]): VerificationStepRow[] {
  return [...steps].sort((left, right) => {
    const leftIndex = VERIFICATION_STEP_ORDER.indexOf(
      (left.step_type as (typeof VERIFICATION_STEP_ORDER)[number] | undefined) ?? "phone"
    );
    const rightIndex = VERIFICATION_STEP_ORDER.indexOf(
      (right.step_type as (typeof VERIFICATION_STEP_ORDER)[number] | undefined) ?? "phone"
    );

    return leftIndex - rightIndex;
  });
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
    .select("id, account_verification_status, location_province, location_city")
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
        "step_type, status, reviewed_at, reason_code, reason_note, risk_level, submitted_at, location_method, location_province, location_city, location_town, phone_verified_at, metadata"
      )
      .eq("user_id", userId);

    steps = ((stepsResult.data as VerificationStepDbRow[] | null) ?? []).map(
      mapVerificationStepRow
    );

    try {
      const pendingArtifactsResult = await client
        .from("kyc_artifacts")
        .select("step_type, status, created_at")
        .eq("user_id", userId)
        .in("step_type", [...RECOVERABLE_PENDING_ARTIFACT_STEPS]);

      const recoveredPendingSteps = mergeRecoveredPendingArtifactSteps(
        steps,
        latestArtifactByStep((pendingArtifactsResult.data as PendingArtifactRow[] | null) ?? [])
      );

      steps = recoveredPendingSteps.steps;

      if (recoveredPendingSteps.recoveredStepTypes.length > 0) {
        log.info("Recovered pending verification steps from artifacts", {
          userId,
          recoveredStepTypes: recoveredPendingSteps.recoveredStepTypes,
        });
      }
    } catch (error) {
      log.warn("Failed to recover pending verification steps from artifacts", {
        userId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }

    const hasPhoneStep = steps.some((step) => step.step_type === "phone");

    if (!hasPhoneStep) {
      try {
        const sessionResult = await client
          .from("verification_sessions")
          .select("phone_verified_at")
          .eq("user_id", userId)
          .maybeSingle();
        const session = (sessionResult.data ?? null) as VerificationSessionRow;
        const phoneVerifiedAt = readStringField(session?.phone_verified_at);

        if (phoneVerifiedAt) {
          steps = sortVerificationSteps([
            ...steps,
            {
              step_type: "phone",
              status: "approved",
              submitted_at: phoneVerifiedAt,
            },
          ]);

          log.info("Recovered approved verification phone step from session", {
            userId,
          });
        }
      } catch (error) {
        log.warn("Failed to recover approved verification phone from session", {
          userId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    const profileHasSavedLocation =
      readStringField(profile?.location_province) !== null &&
      readStringField(profile?.location_city) !== null;
    const profileImpliesSubmittedLocation =
      readAccountVerificationStatus(profile) === "pending_review" ||
      readAccountVerificationStatus(profile) === "verified";
    const hasLocationStep = steps.some((step) => step.step_type === "location");

    if (!hasLocationStep && profileHasSavedLocation) {
      try {
        const sessionResult = await client
          .from("verification_sessions")
          .select("location_submitted_at")
          .eq("user_id", userId)
          .maybeSingle();
        const session = (sessionResult.data ?? null) as VerificationSessionRow;
        const submittedAt = readStringField(session?.location_submitted_at);

        if (submittedAt || profileImpliesSubmittedLocation) {
          steps = sortVerificationSteps([
            ...steps,
            {
              step_type: "location",
              status: "approved",
              submitted_at: submittedAt,
              location_method: "manual",
              location_province: profile?.location_province ?? null,
              location_city: profile?.location_city ?? null,
            },
          ]);

          log.info("Recovered submitted verification location from profile/session", {
            userId,
            source: submittedAt ? "verification_session" : "account_profile",
          });
        }
      } catch (error) {
        log.warn("Failed to recover submitted verification location from session", {
          userId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  const summary = summarizeVerification(profile?.account_verification_status, steps);

  return {
    profile,
    steps,
    ...summary,
  };
}
