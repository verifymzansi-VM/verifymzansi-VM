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
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { MANUAL_ONLY_BASELINE_RISK } from "@/lib/constants/verification";
import { buildVerificationStep } from "@/lib/services/verification-state";
import {
  getProvinceNames,
  getCitiesForProvince,
  normalizeProvinceName,
  resolveCityName,
} from "@/lib/constants/sa-provinces";
import { trimmedStringSchema } from "@/lib/validations/shared";
import { buildVerificationEmailConfirmationRequiredPayload } from "@/lib/constants/verification-email-confirmation";
import {
  ensureLocationVerificationWritable,
  persistLocationVerificationLifecycle,
} from "../_lib/location-verification-lifecycle";

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

    const ensureWritable = await ensureLocationVerificationWritable({
      adminClient,
      profileClient: supabase,
      userId: user.id,
      logger: log,
    });
    if ("response" in ensureWritable) {
      return ensureWritable.response;
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

    const lifecycleResponse = await persistLocationVerificationLifecycle({
      adminClient,
      userId: user.id,
      logger: log,
      locationProvince: normalizedProvince,
      locationCity: normalizedCity,
      currentAccountVerificationStatus: ensureWritable.accountVerificationStatus,
      profileUpdateErrorMessage: "Location saved but failed to update profile status",
      preserveFinalizedSession: ensureWritable.preserveFinalizedSession,
    });
    if (lifecycleResponse) {
      return lifecycleResponse;
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
