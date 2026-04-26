/**
 * POST /api/verification/location/gps
 * Accepts GPS coordinates, reverse-geocodes them, and writes location step evidence.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reverseGeocode, computeLocationConfidence } from "@/lib/services/geocoding";
import { logAuditEvent } from "@/lib/services/audit";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { createLogger } from "@/lib/utils/logger";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { optionalTrimmedStringSchema } from "@/lib/validations/shared";
import { citiesMatch, normalizeProvinceName, resolveCityName } from "@/lib/constants/sa-provinces";

const log = createLogger("GpsVerification");
import {
  GPS_ACCURACY_WARN_METERS,
  GPS_ACCURACY_REJECT_METERS,
  GPS_MAX_AGE_MS,
  GPS_REPLAY_REJECT_MS,
  GPS_PROVINCE_MISMATCH_RISK,
  GPS_CITY_MISMATCH_RISK,
} from "@/lib/constants/verification";
import { buildVerificationStep } from "@/lib/services/verification-state";
import { buildVerificationEmailConfirmationRequiredPayload } from "@/lib/constants/verification-email-confirmation";
import {
  ensureLocationVerificationWritable,
  persistLocationVerificationLifecycle,
} from "../_lib/location-verification-lifecycle";

const gpsLocationSchema = z.object({
  latitude: z.number().min(-35).max(-22),
  longitude: z.number().min(16).max(33),
  accuracy: z.number().positive().finite(),
  timestamp: z.number().positive().finite(),
  declaredProvince: optionalTrimmedStringSchema,
  declaredCity: optionalTrimmedStringSchema,
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

    // Email confirmation gate — users must confirm their email before GPS location
    if (!user.email_confirmed_at) {
      return NextResponse.json(buildVerificationEmailConfirmationRequiredPayload(), {
        status: 403,
      });
    }

    const rateCheck = await checkRateLimit({
      key: getClientIp(request),
      action: "verification:gps",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          { error: "GPS verification protection is temporarily unavailable. Please try again." },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

      return NextResponse.json(
        { error: "Too many GPS verification attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    // Feature flag check
    const gpsEnabled = await isFeatureEnabled("kyc_gps_location");
    if (!gpsEnabled) {
      return NextResponse.json(
        { error: "GPS location verification is not yet enabled" },
        { status: 404 }
      );
    }

    // Parse and validate body
    const bodyResult = await parseAndValidateJsonRequest(request, gpsLocationSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid input",
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { latitude, longitude, accuracy, timestamp, declaredProvince, declaredCity } =
      bodyResult.data;
    const isConfirmationMode = !!declaredProvince;
    const normalizedDeclaredProvince = isConfirmationMode
      ? normalizeProvinceName(declaredProvince)
      : null;
    const gpsAge = Date.now() - timestamp;

    // Reject extremely poor accuracy
    if (accuracy > GPS_ACCURACY_REJECT_METERS) {
      return NextResponse.json(
        {
          error:
            "GPS accuracy is too poor for location verification. Please try again or upload proof of address.",
          code: "gps_accuracy_poor",
          accuracy,
          threshold: GPS_ACCURACY_REJECT_METERS,
        },
        { status: 422 }
      );
    }

    if (gpsAge > GPS_REPLAY_REJECT_MS) {
      return NextResponse.json(
        {
          error: "GPS reading is too old. Request your current location again.",
          code: "gps_replay_detected",
          ageMs: gpsAge,
          thresholdMs: GPS_REPLAY_REJECT_MS,
        },
        { status: 422 }
      );
    }

    const adminClient = createAdminClient();

    const ensureWritable = await ensureLocationVerificationWritable({
      adminClient,
      profileClient: supabase,
      userId: user.id,
      logger: log,
      allowFinalizedLocationConfirmation: isConfirmationMode,
    });
    if ("response" in ensureWritable) {
      return ensureWritable.response;
    }

    if (isConfirmationMode && ensureWritable.finalizedLocationConfirmation) {
      const savedProvince = normalizeProvinceName(ensureWritable.savedLocationProvince);
      const savedCity = ensureWritable.savedLocationCity;
      const provinceMatches =
        savedProvince !== null && savedProvince === normalizedDeclaredProvince;
      const cityMatches =
        !!savedCity && !!declaredCity && citiesMatch(savedProvince, declaredCity, savedCity);

      if (!provinceMatches || !cityMatches) {
        return NextResponse.json(
          { error: "GPS confirmation must match your saved address" },
          { status: 409 }
        );
      }
    }

    // Reverse geocode
    const geoResult = await reverseGeocode(latitude, longitude);
    if (!geoResult.province) {
      return NextResponse.json(
        {
          error:
            "We could not resolve your province from GPS. Please upload proof of residence instead.",
          code: "gps_unresolved",
        },
        { status: 422 }
      );
    }

    const resolvedProvince = geoResult.province;
    const resolvedCity = geoResult.city;
    const confidence = computeLocationConfidence(
      resolvedProvince,
      isConfirmationMode ? (normalizedDeclaredProvince ?? declaredProvince!) : resolvedProvince,
      resolvedCity,
      isConfirmationMode ? (declaredCity ?? resolvedCity ?? "") : (resolvedCity ?? ""),
      accuracy
    );

    // Build risk signals
    const signals: Array<{
      signal_code: string;
      severity: string;
      value_json: Record<string, unknown>;
    }> = [];

    // Mismatch detection in confirmation mode
    const mismatch = { province: false, city: false };
    if (isConfirmationMode) {
      const canonicalResolvedProvince = normalizeProvinceName(resolvedProvince);
      const provinceMatch =
        canonicalResolvedProvince !== null &&
        canonicalResolvedProvince === normalizedDeclaredProvince;
      const cityMatch =
        !!declaredCity &&
        !!resolvedCity &&
        citiesMatch(normalizedDeclaredProvince, resolvedCity, declaredCity);

      mismatch.province = !provinceMatch;
      mismatch.city = provinceMatch && !!declaredCity && !!resolvedCity && !cityMatch;

      if (!provinceMatch) {
        signals.push({
          signal_code: "gps_province_mismatch",
          severity: "block",
          value_json: {
            declared_province: declaredProvince,
            gps_province: resolvedProvince,
          },
        });
      }
      if (provinceMatch && !cityMatch) {
        signals.push({
          signal_code: "gps_city_mismatch",
          severity: "warn",
          value_json: {
            declared_city: declaredCity,
            gps_city: resolvedCity,
          },
        });
      }
    }

    if (geoResult.source !== "nominatim" || !resolvedCity) {
      signals.push({
        signal_code: "gps_low_resolution",
        severity: "warn",
        value_json: {
          gps_province: resolvedProvince,
          gps_city: resolvedCity,
          source: geoResult.source,
          confidence,
        },
      });
    }

    // Low accuracy
    if (accuracy > GPS_ACCURACY_WARN_METERS) {
      signals.push({
        signal_code: "gps_low_accuracy",
        severity: "warn",
        value_json: {
          accuracy_meters: accuracy,
          threshold: GPS_ACCURACY_WARN_METERS,
        },
      });
    }

    // Stale GPS reading — warn when the reading is older than the preferred freshness window.
    if (gpsAge > GPS_MAX_AGE_MS) {
      signals.push({
        signal_code: "gps_stale_reading",
        severity: "warn",
        value_json: {
          age_ms: gpsAge,
          threshold_ms: GPS_MAX_AGE_MS,
        },
      });
    }

    // Calculate risk score from signals
    let riskScore = 0;
    if (isConfirmationMode) {
      if (mismatch.province) riskScore += GPS_PROVINCE_MISMATCH_RISK;
      else if (mismatch.city) riskScore += GPS_CITY_MISMATCH_RISK;
      // Add standard signal-based risk on top
      for (const sig of signals) {
        if (sig.signal_code.startsWith("gps_province") || sig.signal_code.startsWith("gps_city"))
          continue;
        if (sig.severity === "block") riskScore += 40;
        else if (sig.severity === "warn") riskScore += 15;
      }
    } else {
      for (const sig of signals) {
        if (sig.severity === "block") riskScore += 40;
        else if (sig.severity === "warn") riskScore += 15;
      }
    }
    riskScore = Math.min(riskScore, 100);

    const riskLevel =
      riskScore <= 25 ? "low" : riskScore <= 50 ? "medium" : riskScore <= 75 ? "high" : "critical";
    const gpsVerified = isConfirmationMode ? !mismatch.province && !mismatch.city : true;
    const locationProvince = ensureWritable.finalizedLocationConfirmation
      ? (ensureWritable.savedLocationProvince ?? normalizedDeclaredProvince ?? declaredProvince!)
      : isConfirmationMode
        ? (normalizedDeclaredProvince ?? declaredProvince!)
        : resolvedProvince;
    const locationCity = ensureWritable.finalizedLocationConfirmation
      ? (ensureWritable.savedLocationCity ?? declaredCity ?? resolvedCity)
      : isConfirmationMode
        ? (resolveCityName(normalizedDeclaredProvince, declaredCity ?? resolvedCity ?? null) ??
          declaredCity ??
          resolvedCity)
        : (resolveCityName(resolvedProvince, resolvedCity ?? null) ?? resolvedCity);

    // Upsert verification step — always auto-approved (location is self-service)
    const stepStatus = "approved" as const;
    const stepData = buildVerificationStep(
      {
        user_id: user.id,
        step_type: "location",
        location_method: isConfirmationMode ? "manual_with_gps" : "gps",
        gps_lat: latitude,
        gps_lon: longitude,
        location_province: locationProvince,
        location_city: locationCity,
        risk_score: riskScore,
        risk_level: riskLevel,
        auto_status: "approved",
        submitted_at: new Date().toISOString(),
        ...(isConfirmationMode
          ? {
              metadata: {
                declared_province: locationProvince,
                declared_city: locationCity,
                gps_province: normalizeProvinceName(resolvedProvince) ?? resolvedProvince,
                gps_city: resolveCityName(resolvedProvince, resolvedCity ?? null) ?? resolvedCity,
                confidence,
                mismatch,
              },
            }
          : {}),
      },
      stepStatus
    );

    let { data: step, error: stepError } = await adminClient
      .from("verification_steps")
      .upsert(stepData, { onConflict: "user_id,step_type" })
      .select("id")
      .single();

    const stepErrorText =
      `${String(stepError?.message ?? "")} ${String(stepError?.details ?? "")}`.toLowerCase();

    const manualWithGpsUnsupported =
      isConfirmationMode &&
      stepError?.code === "22P02" &&
      (stepErrorText.includes("manual_with_gps") || stepErrorText.includes("location_method"));

    if (manualWithGpsUnsupported) {
      // Backward-compatibility fallback for environments missing the enum migration.
      const fallbackStepData = {
        ...stepData,
        location_method: "gps" as const,
      };

      const fallbackResult = await adminClient
        .from("verification_steps")
        .upsert(fallbackStepData, { onConflict: "user_id,step_type" })
        .select("id")
        .single();

      step = fallbackResult.data;
      stepError = fallbackResult.error;

      if (!stepError) {
        log.warn("location_method enum missing manual_with_gps; fell back to gps", {
          userId: user.id,
        });
      }
    }

    if (stepError || !step) {
      log.error("Failed to upsert step", {
        error: stepError?.message ?? "unknown",
        code: stepError?.code,
        details: stepError?.details,
      });

      // GPS confirmation is optional when users already saved a manual address.
      // Return a non-fatal payload so the UI can keep the saved address flow unblocked.
      if (isConfirmationMode) {
        return NextResponse.json({
          success: true,
          persisted: false,
          warning: "Failed to save location verification",
          verified: false,
          stepStatus,
          confidence,
          resolvedProvince,
          resolvedCity,
          source: geoResult.source,
          riskScore,
          riskLevel,
          mismatch,
        });
      }

      return NextResponse.json({ error: "Failed to save location verification" }, { status: 500 });
    }

    // Write risk signals
    if (signals.length > 0) {
      const signalRows = signals.map((sig) => ({
        user_id: user.id,
        step_id: step.id,
        signal_code: sig.signal_code,
        severity: sig.severity,
        value_json: sig.value_json,
      }));

      const { error: signalInsertErr } = await adminClient
        .from("kyc_risk_signals")
        .insert(signalRows);
      if (signalInsertErr) {
        log.error("Failed to write GPS risk signals (non-fatal)", {
          error: signalInsertErr.message,
          userId: user.id,
        });
      }
    }

    const lifecycleResponse = await persistLocationVerificationLifecycle({
      adminClient,
      userId: user.id,
      logger: log,
      locationProvince,
      locationCity,
      currentAccountVerificationStatus: ensureWritable.accountVerificationStatus,
      profileUpdateErrorMessage: "GPS location saved but failed to update profile status",
      preserveFinalizedSession: ensureWritable.finalizedLocationConfirmation,
    });
    if (lifecycleResponse) {
      return lifecycleResponse;
    }

    // Audit log
    await logAuditEvent({
      actorId: user.id,
      actorRole: "member",
      action: "kyc_gps_submitted",
      targetType: "verification_step",
      targetId: step.id,
      metadata: {
        confidence,
        gps_province: resolvedProvince,
        gps_city: resolvedCity,
        source: geoResult.source,
        accuracy_meters: accuracy,
        risk_score: riskScore,
        risk_level: riskLevel,
      },
    });

    return NextResponse.json({
      success: true,
      stepId: step.id,
      verified: gpsVerified,
      stepStatus,
      confidence,
      resolvedProvince,
      resolvedCity,
      source: geoResult.source,
      riskScore,
      riskLevel,
      ...(isConfirmationMode ? { mismatch } : {}),
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
