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
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR, ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("GpsVerification");
import { parseJsonRequest } from "@/lib/utils/api";
import {
  GPS_ACCURACY_WARN_METERS,
  GPS_ACCURACY_REJECT_METERS,
  GPS_PROVINCE_MISMATCH_RISK,
  GPS_CITY_MISMATCH_RISK,
} from "@/lib/constants/verification";
import {
  buildPendingVerificationStep,
  buildVerificationSessionResumePatch,
} from "@/lib/services/verification-state";

/**
 * Canonical province name mapping for South African provinces.
 * Handles common abbreviations and alternate spellings from geocoding APIs.
 */
const SA_PROVINCE_ALIASES: Record<string, string> = {
  "eastern cape": "Eastern Cape",
  ec: "Eastern Cape",
  "free state": "Free State",
  fs: "Free State",
  gauteng: "Gauteng",
  gp: "Gauteng",
  gt: "Gauteng",
  "kwazulu-natal": "KwaZulu-Natal",
  "kwazulu natal": "KwaZulu-Natal",
  kzn: "KwaZulu-Natal",
  limpopo: "Limpopo",
  lp: "Limpopo",
  mpumalanga: "Mpumalanga",
  mp: "Mpumalanga",
  "north west": "North West",
  nw: "North West",
  "northern cape": "Northern Cape",
  nc: "Northern Cape",
  "western cape": "Western Cape",
  wc: "Western Cape",
};

function normalizeProvinceName(province: string): string {
  const lower = province.trim().toLowerCase();
  return SA_PROVINCE_ALIASES[lower] ?? province.trim();
}

const gpsLocationSchema = z.object({
  latitude: z.number().min(-35).max(-22),
  longitude: z.number().min(16).max(33),
  accuracy: z.number().positive(),
  timestamp: z.number().positive(),
  declaredProvince: z.string().optional(),
  declaredCity: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "verification:gps");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
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
    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const parsed = gpsLocationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: parsed.error.issues.map((i) => i.message),
        },
        { status: 400 }
      );
    }

    const {
      latitude,
      longitude,
      accuracy,
      timestamp: _timestamp,
      declaredProvince,
      declaredCity,
    } = parsed.data;
    const isConfirmationMode = !!declaredProvince;

    // Reject extremely poor accuracy
    if (accuracy > GPS_ACCURACY_REJECT_METERS) {
      return NextResponse.json(
        {
          error:
            "GPS accuracy is too poor for location verification. Please try again or upload proof of address.",
          accuracy,
          threshold: GPS_ACCURACY_REJECT_METERS,
        },
        { status: 422 }
      );
    }

    const adminClient = createAdminClient();

    // Check account profile exists
    const { data: profile } = await adminClient
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
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
      isConfirmationMode ? declaredProvince! : resolvedProvince,
      resolvedCity,
      isConfirmationMode ? (declaredCity ?? resolvedProvince) : (resolvedCity ?? resolvedProvince),
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
      const provinceMatch =
        normalizeProvinceName(resolvedProvince) === normalizeProvinceName(declaredProvince!);
      const cityMatch = resolvedCity
        ? resolvedCity.toLowerCase() === (declaredCity ?? "").toLowerCase()
        : false;

      mismatch.province = !provinceMatch;
      mismatch.city = !cityMatch;

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

    // Upsert verification step
    const stepData = buildPendingVerificationStep({
      user_id: user.id,
      step_type: "location",
      location_method: isConfirmationMode ? "manual_with_gps" : "gps",
      gps_lat: latitude,
      gps_lon: longitude,
      location_province: isConfirmationMode ? declaredProvince! : resolvedProvince,
      location_city: isConfirmationMode ? (declaredCity ?? resolvedCity) : resolvedCity,
      risk_score: riskScore,
      risk_level: riskLevel,
      auto_status: riskScore <= 25 ? "approved" : "needs_manual_review",
      submitted_at: new Date().toISOString(),
      ...(isConfirmationMode
        ? {
            metadata: {
              declared_province: declaredProvince,
              declared_city: declaredCity,
              gps_province: resolvedProvince,
              gps_city: resolvedCity,
              mismatch,
            },
          }
        : {}),
    });

    const { data: step, error: stepError } = await adminClient
      .from("verification_steps")
      .upsert(stepData, { onConflict: "user_id,step_type" })
      .select("id")
      .single();

    if (stepError || !step) {
      log.error("Failed to upsert step", { error: stepError?.message ?? "unknown" });
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

      await adminClient.from("kyc_risk_signals").insert(signalRows);
    }

    // Update verification session
    await adminClient.from("verification_sessions").upsert(
      buildVerificationSessionResumePatch(user.id, {
        location_submitted_at: new Date().toISOString(),
      }),
      { onConflict: "user_id" }
    );

    // Update account profile — use declared values in confirmation mode
    await adminClient
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update({
        location_province: isConfirmationMode ? declaredProvince! : resolvedProvince,
        location_city: isConfirmationMode ? (declaredCity ?? resolvedCity) : resolvedCity,
      })
      .eq("user_id", user.id);

    // Set pending_review if currently incomplete
    await adminClient
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
