import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ACCOUNT_PROFILE_NOT_FOUND_ERROR, ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { summarizeVerification } from "@/lib/account/verification-summary";
import { buildVerificationSessionResumePatch } from "@/lib/services/verification-state";
type QueryClient = Pick<SupabaseClient, "from">;

type VerificationSessionRow = {
  id_artifact_id?: string | null;
  selfie_artifact_id?: string | null;
  location_submitted_at?: string | null;
  finalized_at?: string | null;
};

type VerificationPhoneStepRow = {
  phone_verified_at?: string | null;
};

type VerificationProfileRow = {
  id?: string;
  account_verification_status?: string | null;
};

type VerificationStepIdentityRow = {
  first_name?: string | null;
  last_name?: string | null;
};

type VerificationStepLocationRow = {
  status?: string | null;
  location_method?: string | null;
  location_province?: string | null;
  location_city?: string | null;
};

type RouteLogger = {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

type EnsureResult =
  | {
      accountVerificationStatus: string | null;
      finalizedLocationConfirmation: boolean;
      savedLocationProvince: string | null;
      savedLocationCity: string | null;
    }
  | { response: NextResponse };

type EnsureArgs = {
  adminClient: QueryClient;
  profileClient: QueryClient;
  userId: string;
  logger: RouteLogger;
  allowFinalizedLocationConfirmation?: boolean;
};

type PersistArgs = {
  adminClient: QueryClient;
  userId: string;
  logger: RouteLogger;
  locationProvince: string;
  locationCity: string | null | undefined;
  currentAccountVerificationStatus: string | null;
  profileUpdateErrorMessage: string;
  preserveFinalizedSession?: boolean;
};

async function finalizeVerificationSessionIfReady(
  adminClient: QueryClient,
  userId: string,
  logger: RouteLogger
) {
  const { data: currentSession, error: sessionFetchErr } = await adminClient
    .from("verification_sessions")
    .select("id_artifact_id, selfie_artifact_id, location_submitted_at, finalized_at")
    .eq("user_id", userId)
    .maybeSingle();
  const session = currentSession as VerificationSessionRow | null;

  if (sessionFetchErr) {
    logger.warn("Failed to fetch session for finalization check (non-fatal)", {
      userId,
      error: sessionFetchErr.message,
    });
    return;
  }

  const { data: phoneStep, error: phoneFetchErr } = await adminClient
    .from("verification_steps")
    .select("phone_verified_at")
    .eq("user_id", userId)
    .eq("step_type", "phone")
    .maybeSingle();
  const phoneVerification = phoneStep as VerificationPhoneStepRow | null;

  if (phoneFetchErr) {
    logger.warn("Failed to fetch phone step for finalization check (non-fatal)", {
      userId,
      error: phoneFetchErr.message,
    });
  }

  if (
    session &&
    !session.finalized_at &&
    session.id_artifact_id &&
    session.selfie_artifact_id &&
    session.location_submitted_at &&
    phoneVerification?.phone_verified_at
  ) {
    const { error: finalizeErr } = await adminClient
      .from("verification_sessions")
      .update({ finalized_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("finalized_at", null);

    if (finalizeErr) {
      logger.error("Failed to finalize verification session (non-fatal)", {
        error: finalizeErr.message,
        userId,
      });
    }
  }
}

export async function ensureLocationVerificationWritable({
  adminClient,
  profileClient,
  userId,
  logger,
  allowFinalizedLocationConfirmation = false,
}: EnsureArgs): Promise<EnsureResult> {
  const { data: existingSession, error: sessionFetchErr } = await adminClient
    .from("verification_sessions")
    .select("finalized_at, location_submitted_at")
    .eq("user_id", userId)
    .maybeSingle();
  const existingVerificationSession = existingSession as VerificationSessionRow | null;

  if (sessionFetchErr) {
    logger.error("Failed to fetch verification session", {
      userId,
      error: sessionFetchErr.message,
    });
    return {
      response: NextResponse.json(
        { error: "Unable to check verification session" },
        { status: 500 }
      ),
    };
  }

  let finalizedLocationConfirmation = false;
  let savedLocationProvince: string | null = null;
  let savedLocationCity: string | null = null;

  if (existingVerificationSession?.finalized_at) {
    const allowFinalizedConfirmation =
      allowFinalizedLocationConfirmation && existingVerificationSession.location_submitted_at;

    if (allowFinalizedConfirmation) {
      const { data: locationStep, error: locationStepErr } = await adminClient
        .from("verification_steps")
        .select("status, location_method, location_province, location_city")
        .eq("user_id", userId)
        .eq("step_type", "location")
        .maybeSingle();
      const existingLocationStep = locationStep as VerificationStepLocationRow | null;

      if (locationStepErr) {
        logger.error("Failed to fetch finalized location step", {
          userId,
          error: locationStepErr.message,
        });
        return {
          response: NextResponse.json(
            { error: "Unable to check location verification" },
            { status: 500 }
          ),
        };
      }

      const locationIsSubmitted =
        existingLocationStep?.status === "approved" || existingLocationStep?.status === "pending";
      const locationCanReceiveGpsConfirmation =
        existingLocationStep?.location_method === "manual" ||
        existingLocationStep?.location_method === "manual_with_gps";

      if (locationIsSubmitted && locationCanReceiveGpsConfirmation) {
        finalizedLocationConfirmation = true;
        savedLocationProvince = existingLocationStep.location_province ?? null;
        savedLocationCity = existingLocationStep.location_city ?? null;
      }
    }

    if (!finalizedLocationConfirmation) {
      return {
        response: NextResponse.json(
          { error: "Verification session is already finalized" },
          { status: 409 }
        ),
      };
    }
  }

  const { data: profile, error: profileErr } = await profileClient
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .select("id, account_verification_status")
    .eq("user_id", userId)
    .maybeSingle();
  const accountProfile = profile as VerificationProfileRow | null;

  if (profileErr) {
    logger.error("Failed to fetch account profile", { userId, error: profileErr.message });
    return {
      response: NextResponse.json({ error: "Unable to verify account" }, { status: 500 }),
    };
  }

  if (!accountProfile) {
    return {
      response: NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 }),
    };
  }

  return {
    accountVerificationStatus: accountProfile.account_verification_status ?? null,
    finalizedLocationConfirmation,
    savedLocationProvince,
    savedLocationCity,
  };
}

export async function persistLocationVerificationLifecycle({
  adminClient,
  userId,
  logger,
  locationProvince,
  locationCity,
  currentAccountVerificationStatus,
  profileUpdateErrorMessage,
  preserveFinalizedSession = false,
}: PersistArgs): Promise<NextResponse | null> {
  const submittedAt = new Date().toISOString();
  const sessionPatch = preserveFinalizedSession
    ? {
        user_id: userId,
        location_submitted_at: submittedAt,
      }
    : buildVerificationSessionResumePatch(userId, {
        location_submitted_at: submittedAt,
      });

  const { error: sessionErr } = await adminClient
    .from("verification_sessions")
    .upsert(sessionPatch, { onConflict: "user_id" });
  if (sessionErr) {
    logger.error("Failed to update verification session (non-fatal)", {
      error: sessionErr.message,
      userId,
    });
  }

  await finalizeVerificationSessionIfReady(adminClient, userId, logger);

  const profilePatch: Record<string, unknown> = {
    location_province: locationProvince,
    location_city: locationCity,
  };

  const { data: allSteps, error: allStepsErr } = await adminClient
    .from("verification_steps")
    .select("step_type, status")
    .eq("user_id", userId);

  if (allStepsErr) {
    logger.warn("Failed to fetch verification steps (non-fatal)", {
      userId,
      error: allStepsErr.message,
    });
  }

  const verificationSummary = summarizeVerification(
    currentAccountVerificationStatus,
    allSteps ?? []
  );
  profilePatch.account_verification_status = verificationSummary.accountVerificationStatus;

  if (verificationSummary.accountVerificationStatus === "verified") {
    const { data: idDocDetail } = await adminClient
      .from("verification_steps")
      .select("first_name, last_name")
      .eq("user_id", userId)
      .eq("step_type", "id_doc")
      .maybeSingle();
    const idDocumentIdentity = idDocDetail as VerificationStepIdentityRow | null;

    if (idDocumentIdentity?.first_name && idDocumentIdentity?.last_name) {
      profilePatch.legal_first_name = idDocumentIdentity.first_name;
      profilePatch.legal_last_name = idDocumentIdentity.last_name;
      profilePatch.display_name = `${idDocumentIdentity.first_name} ${idDocumentIdentity.last_name}`;
      profilePatch.legal_name_locked_at = new Date().toISOString();
    }

    const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error: purgeErr } = await adminClient
      .from("kyc_artifacts")
      .update({ purge_after: purgeAfter })
      .eq("user_id", userId)
      .is("purge_after", null);
    if (purgeErr) {
      logger.error("Failed to schedule KYC artifact purge (non-fatal)", {
        error: purgeErr.message,
        userId,
      });
    }
  }

  const { error: profileUpdateErr } = await adminClient
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .update(profilePatch)
    .eq("user_id", userId);
  if (profileUpdateErr) {
    logger.error("Failed to update profile after location verification", {
      userId,
      error: profileUpdateErr.message,
    });
    return NextResponse.json({ error: profileUpdateErrorMessage }, { status: 500 });
  }

  return null;
}
