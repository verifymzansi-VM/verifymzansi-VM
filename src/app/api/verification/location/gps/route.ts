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
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR } from "@/lib/account/compat";

const log = createLogger("GpsVerification");
import { parseJsonRequest } from "@/lib/utils/api";
import { GPS_ACCURACY_WARN_METERS, GPS_ACCURACY_REJECT_METERS } from "@/lib/constants/verification";
import { getProvinceNames } from "@/lib/constants/sa-provinces";
import {
  buildPendingVerificationStep,
  buildVerificationSessionResumePatch,
} from "@/lib/services/verification-state";

const gpsLocationSchema = z.object({
  latitude: z.number().min(-35).max(-22),
  longitude: z.number().min(16).max(33),
  accuracy: z.number().positive(),
  timestamp: z.number().positive(),
  province: z.string().min(1),
  city: z.string().min(1),
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

    const { latitude, longitude, accuracy, timestamp: _timestamp, province, city } = parsed.data;

    // Validate province is a valid SA province
    const validProvinces = getProvinceNames();
    if (!validProvinces.includes(province)) {
      return NextResponse.json(
        { error: `Invalid province. Must be one of: ${validProvinces.join(", ")}` },
        { status: 400 }
      );
    }

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
      .from("account_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    // Reverse geocode
    const geoResult = await reverseGeocode(latitude, longitude);
    const confidence = computeLocationConfidence(
      geoResult.province,
      province,
      geoResult.city,
      city,
      accuracy
    );

    // Build risk signals
    const signals: Array<{
      signal_code: string;
      severity: string;
      value_json: Record<string, unknown>;
    }> = [];

    // Province mismatch
    if (geoResult.province && geoResult.province.toLowerCase() !== province.toLowerCase()) {
      signals.push({
        signal_code: "gps_province_mismatch",
        severity: "warn",
        value_json: {
          gps_province: geoResult.province,
          declared_province: province,
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
    for (const sig of signals) {
      if (sig.severity === "block") riskScore += 40;
      else if (sig.severity === "warn") riskScore += 15;
    }
    riskScore = Math.min(riskScore, 100);

    const riskLevel =
      riskScore <= 25 ? "low" : riskScore <= 50 ? "medium" : riskScore <= 75 ? "high" : "critical";

    // Upsert verification step
    const { data: step, error: stepError } = await adminClient
      .from("verification_steps")
      .upsert(
        buildPendingVerificationStep({
          user_id: user.id,
          step_type: "location",
          location_method: "gps",
          gps_lat: latitude,
          gps_lon: longitude,
          location_province: province,
          location_city: city,
          risk_score: riskScore,
          risk_level: riskLevel,
          auto_status: riskScore > 50 ? "needs_manual_review" : "approved",
          submitted_at: new Date().toISOString(),
        }),
        { onConflict: "user_id,step_type" }
      )
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

    // Update account profile
    await adminClient
      .from("account_profiles")
      .update({
        location_province: province,
        location_city: city,
      })
      .eq("user_id", user.id);

    // Set pending_review if currently incomplete
    await adminClient
      .from("account_profiles")
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
        gps_province: geoResult.province,
        declared_province: province,
        accuracy_meters: accuracy,
        risk_score: riskScore,
        risk_level: riskLevel,
      },
    });

    return NextResponse.json({
      success: true,
      stepId: step.id,
      confidence,
      gpsProvince: geoResult.province,
      gpsCity: geoResult.city,
      gpsDeclaredMatch: geoResult.province?.toLowerCase() === province.toLowerCase(),
      riskScore,
      riskLevel,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
