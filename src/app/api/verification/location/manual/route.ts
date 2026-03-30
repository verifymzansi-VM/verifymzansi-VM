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
  buildPendingVerificationStep,
  buildVerificationSessionResumePatch,
} from "@/lib/services/verification-state";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
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

    // Validate province
    const validProvinces = getProvinceNames();
    if (!validProvinces.includes(province)) {
      return NextResponse.json(
        { error: "Invalid province. Please select a valid South African province." },
        { status: 400 }
      );
    }

    // Validate city belongs to province
    const validCities = getCitiesForProvince(province);
    if (!validCities.includes(city)) {
      return NextResponse.json(
        { error: "Invalid city for the selected province." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Reject if verification session is already finalized
    const { data: existingSession } = await adminClient
      .from("verification_sessions")
      .select("finalized_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingSession?.finalized_at) {
      return NextResponse.json(
        { error: "Verification session is already finalized" },
        { status: 409 }
      );
    }

    // Check account profile exists
    const { data: profile } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    const riskScore = MANUAL_ONLY_BASELINE_RISK;
    const riskLevel = riskScore <= 25 ? "low" : "medium";

    // Upsert verification step
    const { data: step, error: stepError } = await adminClient
      .from("verification_steps")
      .upsert(
        buildPendingVerificationStep({
          user_id: user.id,
          step_type: "location",
          location_method: "manual",
          gps_lat: null,
          gps_lon: null,
          location_province: province,
          location_city: city,
          location_town: town || null,
          risk_score: riskScore,
          risk_level: riskLevel,
          auto_status: "needs_manual_review",
          submitted_at: new Date().toISOString(),
        }),
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
      return NextResponse.json(
        { error: "Failed to save location verification", detail: stepError?.message },
        { status: 500 }
      );
    }

    // Write risk signal for manual-only submission
    await adminClient.from("kyc_risk_signals").insert({
      user_id: user.id,
      step_id: step.id,
      signal_code: "manual_only_location",
      severity: "info",
      value_json: {
        province,
        city,
        town: town || undefined,
        note: "Location submitted via manual selection without GPS confirmation",
      },
    });

    // Update verification session
    await adminClient.from("verification_sessions").upsert(
      buildVerificationSessionResumePatch(user.id, {
        location_submitted_at: new Date().toISOString(),
      }),
      { onConflict: "user_id" }
    );

    // Update account profile
    await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update({
        location_province: province,
        location_city: city,
      })
      .eq("user_id", user.id);

    // Set pending_review if currently incomplete
    await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update({
        account_verification_status: "pending_review",
      })
      .eq("user_id", user.id)
      .in("account_verification_status", ["incomplete", "rejected"]);

    // Audit log
    await logAuditEvent({
      actorId: user.id,
      actorRole: "member",
      action: "kyc_manual_location_submitted",
      targetType: "verification_step",
      targetId: step.id,
      metadata: {
        province,
        city,
        risk_score: riskScore,
        risk_level: riskLevel,
      },
    });

    return NextResponse.json({
      success: true,
      stepId: step.id,
      province,
      city,
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
