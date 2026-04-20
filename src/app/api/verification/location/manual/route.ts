/**
 * POST /api/verification/location/manual
 * Accepts a manually selected province + city and writes the location verification step.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR, ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { MANUAL_ONLY_BASELINE_RISK } from "@/lib/constants/verification";
import {
  buildVerificationStep,
  buildVerificationSessionResumePatch,
} from "@/lib/services/verification-state";
import { summarizeVerification } from "@/lib/account/verification-summary";
import {
  getProvinceNames,
  getCitiesForProvince,
  normalizeProvinceName,
  resolveCityName,
} from "@/lib/constants/sa-provinces";
import { trimmedStringSchema } from "@/lib/validations/shared";
import { buildVerificationEmailConfirmationRequiredPayload } from "@/lib/constants/verification-email-confirmation";

const log = createLogger("ManualLocationVerification");

const manualLocationSchema = z.object({
  province: trimmedStringSchema,
  city: trimmedStringSchema,
  town: z.string().trim().max(120).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) {
      return originBlock;
    }

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) {
      return csrfBlock;
    }

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Email confirmation gate — users must confirm their email before manual location
    if (!user.email_confirmed_at) {
      return NextResponse.json(buildVerificationEmailConfirmationRequiredPayload(), {
        status: 403,
      });
    }

    // Feature flag check — must match session start route
    const v2Enabled = await isFeatureEnabled("kyc_v2_flow");
    if (!v2Enabled) {
      return NextResponse.json(
        {
          error: "New verification flow is not yet enabled",
          code: "kyc_v2_disabled",
        },
        { status: 404 }
      );
    }

    const rateCheck = await checkRateLimit({
      key: getClientIp(request),
      action: "verification:manual-location",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          {
            error:
              "Manual location verification protection is temporarily unavailable. Please try again.",
          },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

      return NextResponse.json(
        { error: "Too many manual location attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    // Parse and validate body
    const bodyResult = await parseAndValidateJsonRequest(request, manualLocationSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid input",
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { province, city, town } = bodyResult.data;
    const normalizedProvince = normalizeProvinceName(province);

    // Validate province
    const validProvinces = getProvinceNames();
    if (!normalizedProvince || !validProvinces.includes(normalizedProvince)) {
      return NextResponse.json(
        { error: "Invalid province. Please select a valid South African province." },
        { status: 400 }
      );
    }

    // Validate city belongs to province
    const normalizedCity = resolveCityName(normalizedProvince, city);
    const validCities = getCitiesForProvince(normalizedProvince);
    if (!normalizedCity || !validCities.includes(normalizedCity)) {
      return NextResponse.json(
        { error: "Invalid city for the selected province." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Reject if verification session is already finalized
    const { data: existingSession, error: sessionFetchErr } = await adminClient
      .from("verification_sessions")
      .select("finalized_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (sessionFetchErr) {
      log.error("Failed to fetch verification session", {
        userId: user.id,
        error: sessionFetchErr.message,
      });
      return NextResponse.json({ error: "Unable to check verification session" }, { status: 500 });
    }
    if (existingSession?.finalized_at) {
      return NextResponse.json(
        { error: "Verification session is already finalized" },
        { status: 409 }
      );
    }

    // Check account profile exists
    const { data: profile, error: profileErr } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileErr) {
      log.error("Failed to fetch account profile", { userId: user.id, error: profileErr.message });
      return NextResponse.json({ error: "Unable to verify account" }, { status: 500 });
    }

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    const riskScore = MANUAL_ONLY_BASELINE_RISK;
    const riskLevel = riskScore <= 25 ? "low" : "medium";

    // Upsert verification step — auto-approved (location is self-service)
    const { data: step, error: stepError } = await adminClient
      .from("verification_steps")
      .upsert(
        buildVerificationStep(
          {
            user_id: user.id,
            step_type: "location",
            location_method: "manual",
            gps_lat: null,
            gps_lon: null,
            location_province: normalizedProvince,
            location_city: normalizedCity,
            location_town: town || null,
            risk_score: riskScore,
            risk_level: riskLevel,
            auto_status: "approved",
            submitted_at: new Date().toISOString(),
          },
          "approved"
        ),
        { onConflict: "user_id,step_type" }
      )
      .select("id")
      .single();

    if (stepError || !step) {
      log.error("Failed to upsert step", {
        error: stepError?.message ?? "unknown",
        code: stepError?.code,
        details: stepError?.details,
      });
      return NextResponse.json({ error: "Failed to save location verification" }, { status: 500 });
    }

    // Write risk signal for manual-only submission
    const { error: signalErr } = await adminClient.from("kyc_risk_signals").insert({
      user_id: user.id,
      step_id: step.id,
      signal_code: "manual_only_location",
      severity: "info",
      value_json: {
        province: normalizedProvince,
        city: normalizedCity,
        town: town || undefined,
        note: "Location submitted via manual selection without GPS confirmation",
      },
    });
    if (signalErr) {
      log.error("Failed to write manual-location risk signal (non-fatal)", {
        error: signalErr.message,
        userId: user.id,
      });
    }

    // Update verification session
    const { error: sessionErr } = await adminClient.from("verification_sessions").upsert(
      buildVerificationSessionResumePatch(user.id, {
        location_submitted_at: new Date().toISOString(),
      }),
      { onConflict: "user_id" }
    );
    if (sessionErr) {
      log.error("Failed to update verification session (non-fatal)", {
        error: sessionErr.message,
        userId: user.id,
      });
    }

    // Update account profile with location
    const profilePatch: Record<string, unknown> = {
      location_province: normalizedProvince,
      location_city: normalizedCity,
    };

    // Check if all verification steps are now approved → promote to verified
    const { data: allSteps, error: allStepsErr } = await adminClient
      .from("verification_steps")
      .select("step_type, status")
      .eq("user_id", user.id);

    if (allStepsErr) {
      log.warn("Failed to fetch verification steps (non-fatal)", {
        userId: user.id,
        error: allStepsErr.message,
      });
    }

    const { data: profileRow, error: profileRowErr } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("account_verification_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileRowErr) {
      log.warn("Failed to fetch profile for status check (non-fatal)", {
        userId: user.id,
        error: profileRowErr.message,
      });
    }

    const verificationSummary = summarizeVerification(
      profileRow?.account_verification_status,
      allSteps ?? []
    );

    profilePatch.account_verification_status = verificationSummary.accountVerificationStatus;

    if (verificationSummary.accountVerificationStatus === "verified") {
      const { data: idDocDetail } = await adminClient
        .from("verification_steps")
        .select("first_name, last_name")
        .eq("user_id", user.id)
        .eq("step_type", "id_doc")
        .maybeSingle();

      if (idDocDetail?.first_name && idDocDetail?.last_name) {
        profilePatch.legal_first_name = idDocDetail.first_name;
        profilePatch.legal_last_name = idDocDetail.last_name;
        profilePatch.display_name = `${idDocDetail.first_name} ${idDocDetail.last_name}`;
        profilePatch.legal_name_locked_at = new Date().toISOString();
      }

      const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error: purgeErr } = await adminClient
        .from("kyc_artifacts")
        .update({ purge_after: purgeAfter })
        .eq("user_id", user.id)
        .is("purge_after", null);
      if (purgeErr) {
        log.error("Failed to schedule KYC artifact purge (non-fatal)", {
          error: purgeErr.message,
          userId: user.id,
        });
      }
    }

    const { error: profileUpdateErr } = await adminClient
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update(profilePatch)
      .eq("user_id", user.id);
    if (profileUpdateErr) {
      log.error("Failed to update profile after location verification", {
        userId: user.id,
        error: profileUpdateErr.message,
      });
      return NextResponse.json(
        { error: "Location saved but failed to update profile status" },
        { status: 500 }
      );
    }

    // Audit log
    await logAuditEvent({
      actorId: user.id,
      actorRole: "member",
      action: "kyc_manual_location_submitted",
      targetType: "verification_step",
      targetId: step.id,
      metadata: {
        province: normalizedProvince,
        city: normalizedCity,
        risk_score: riskScore,
        risk_level: riskLevel,
      },
    });

    return NextResponse.json({
      success: true,
      stepId: step.id,
      province: normalizedProvince,
      city: normalizedCity,
      riskScore,
      riskLevel,
    });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
