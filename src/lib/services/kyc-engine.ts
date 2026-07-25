import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { getConfiguredProvider } from "./kyc-provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RiskLevel } from "@/types/enums";
import type { ExifSignals } from "@/lib/utils/exif-inspect";
import {
  BLUR_VARIANCE_THRESHOLD,
  FACE_MATCH_THRESHOLD,
  LIVENESS_THRESHOLD,
} from "@/lib/constants/verification";
import { hammingDistance, PHASH_SIMILARITY_THRESHOLD } from "@/lib/utils/perceptual-hash";

const log = createLogger("KycEngine");

// ── Signal severity weights → risk score contribution ────────
const SEVERITY_WEIGHT: Record<string, number> = {
  block: 40,
  warn: 15,
  info: 0,
};

// ── Risk score → risk level mapping ──────────────────────────
function deriveRiskLevel(score: number): RiskLevel {
  if (score <= 25) return "low";
  if (score <= 50) return "medium";
  if (score <= 75) return "high";
  return "critical";
}

export interface KycEngineInput {
  artifactId: string;
  userId: string;
  stepType: string;
  fileBuffer: Buffer;
  r2Key: string;
  idNumber?: string;
  adminClient: SupabaseClient;
  captureMethod?: "camera" | "file_upload";
  exifSignals?: ExifSignals | null;
  blurScore?: number | null;
  /** Pre-computed perceptual hash (dHash, 16-char hex) for near-duplicate detection */
  phash?: string | null;
  /** Pre-computed: phone is linked to a rejected account (block signal) */
  phoneFlagged?: boolean;
}

export interface KycEngineOutput {
  sha256: string;
  phash: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  providerRef: string | undefined;
  autoStatus: "pending" | "approved" | "rejected" | "needs_manual_review";
  idNumberHmac: string | undefined;
}

/**
 * Processes a newly uploaded KYC artifact:
 * 1. Computes SHA-256 and checks for duplicate submissions across accounts.
 * 2. Checks upload velocity (warn fires on the 3rd upload in 24h for the same
 *    step type — the RPC default is p_max_per_24h = 3 and the count includes
 *    the just-inserted artifact).
 * 3. Checks ID number HMAC reuse across accounts (id_doc only).
 * 4. Calls the configured KYC provider and persists the result.
 * 5. Aggregates signals into a risk score and level.
 *
 * Returns scoring data to be written to the verification_steps and
 * kyc_artifacts rows by the caller.
 */
export async function processKycArtifact(input: KycEngineInput): Promise<KycEngineOutput> {
  const {
    artifactId,
    userId,
    stepType,
    fileBuffer,
    r2Key,
    idNumber,
    adminClient,
    captureMethod,
    exifSignals,
    blurScore,
    phash,
    phoneFlagged,
  } = input;
  let signalScore = 0;

  // ── 1. SHA-256 deduplication ──────────────────────────────
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  const { data: dupRows, error: dupErr } = await adminClient
    .from("kyc_artifacts")
    .select("id, user_id")
    .eq("sha256", sha256)
    .neq("user_id", userId)
    .limit(1);

  if (dupErr) {
    log.error("SHA-256 dedup query failed — treating as block", { error: dupErr.message });
    await writeSignal(adminClient, {
      userId,
      artifactId,
      signalCode: "duplicate_sha256_check_error",
      severity: "block",
      valueJson: { error: dupErr.message },
    });
    signalScore += SEVERITY_WEIGHT.block;
  } else if (dupRows && dupRows.length > 0) {
    log.warn("Duplicate SHA-256 detected across accounts", {
      sha256: sha256.slice(0, 8) + "...",
      otherUserId: dupRows[0].user_id,
    });
    await writeSignal(adminClient, {
      userId,
      artifactId,
      signalCode: "duplicate_sha256",
      severity: "block",
      valueJson: { matchingArtifactId: dupRows[0].id },
    });
    signalScore += SEVERITY_WEIGHT.block;
  }

  // ── 1b. Perceptual hash near-duplicate detection ──────────
  if (phash) {
    // Query recent artifacts from OTHER users that have a phash stored
    const { data: phashRows, error: phashErr } = await adminClient
      .from("kyc_artifacts")
      .select("id, user_id, phash")
      .neq("user_id", userId)
      .not("phash", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (phashErr) {
      log.error("Perceptual hash query failed", { error: phashErr.message });
    } else if (phashRows) {
      for (const row of phashRows) {
        if (row.phash && hammingDistance(phash, row.phash) <= PHASH_SIMILARITY_THRESHOLD) {
          log.warn("Near-duplicate image detected via perceptual hash", {
            phash: phash.slice(0, 8) + "...",
            otherUserId: row.user_id,
            otherArtifactId: row.id,
            distance: hammingDistance(phash, row.phash),
          });
          await writeSignal(adminClient, {
            userId,
            artifactId,
            signalCode: "near_duplicate_phash",
            severity: "warn",
            valueJson: {
              matchingArtifactId: row.id,
              distance: hammingDistance(phash, row.phash),
            },
          });
          signalScore += SEVERITY_WEIGHT.warn;
          break; // one match is enough
        }
      }
    }
  }

  // ── 2. Velocity check (atomic, race-safe via DB advisory lock) ──
  const { data: velocityOk, error: velocityErr } = await adminClient.rpc("check_kyc_velocity", {
    p_user_id: userId,
    p_step_type: stepType,
  });

  if (velocityErr) {
    log.error("Velocity check RPC failed", { error: velocityErr.message });
    // In production, treat velocity check failure as block-level to prevent abuse.
    // In non-production, fail open with a warning to avoid blocking development.
    const velocityFailSeverity = process.env.NODE_ENV === "production" ? "block" : "warn";
    await writeSignal(adminClient, {
      userId,
      artifactId,
      signalCode: "velocity_check_error",
      severity: velocityFailSeverity,
      valueJson: { error: velocityErr.message },
    });
    signalScore += SEVERITY_WEIGHT[velocityFailSeverity];
  } else if (velocityOk === false) {
    log.warn("Velocity threshold exceeded (DB-enforced)", { userId, stepType });
    await writeSignal(adminClient, {
      userId,
      artifactId,
      signalCode: "velocity_resubmit",
      severity: "warn",
      valueJson: { enforced: "database" },
    });
    signalScore += SEVERITY_WEIGHT.warn;
  }

  // ── 3. ID number HMAC reuse check (id_doc only) ──────────
  let idNumberHmac: string | undefined;
  if (stepType === "id_doc" && idNumber) {
    const hmacSecret = env("HMAC_SECRET");
    const ZERO_KEY = "0".repeat(64);
    const CAFEBABE_PLACEHOLDER = "cafebabe".repeat(8);
    const isLowEntropy =
      hmacSecret != null && hmacSecret.length === 64 && new Set(hmacSecret).size < 8;
    if (
      !hmacSecret ||
      hmacSecret === ZERO_KEY ||
      hmacSecret === CAFEBABE_PLACEHOLDER ||
      isLowEntropy
    ) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "HMAC_SECRET is not configured — cannot process KYC artifacts in production"
        );
      }
      log.error("HMAC_SECRET not set or is placeholder — ID reuse detection disabled");
      // Add risk signal so the result reflects the degraded check
      await writeSignal(adminClient, {
        userId,
        artifactId,
        signalCode: "hmac_unavailable",
        severity: "warn",
        valueJson: { reason: "HMAC_SECRET not configured" },
      });
      signalScore += SEVERITY_WEIGHT.warn;
    } else {
      idNumberHmac = crypto
        .createHmac("sha256", Buffer.from(hmacSecret, "hex"))
        .update(idNumber)
        .digest("hex");

      const { data: hmacRows, error: hmacErr } = await adminClient
        .from("verification_steps")
        .select("id, user_id")
        .eq("id_number_hmac", idNumberHmac)
        .neq("user_id", userId)
        .limit(1);

      if (hmacErr) {
        log.error("HMAC reuse query failed — treating as block", { error: hmacErr.message });
        await writeSignal(adminClient, {
          userId,
          artifactId,
          signalCode: "id_reuse_check_error",
          severity: "block",
          valueJson: { error: hmacErr.message },
        });
        signalScore += SEVERITY_WEIGHT.block;
      } else if (hmacRows && hmacRows.length > 0) {
        log.warn("ID number HMAC reuse detected across accounts", {
          hmacPrefix: idNumberHmac.slice(0, 8) + "...",
        });
        await writeSignal(adminClient, {
          userId,
          artifactId,
          signalCode: "id_number_reuse",
          severity: "block",
          valueJson: { conflictingStepId: hmacRows[0].id },
        });
        signalScore += SEVERITY_WEIGHT.block;
      }
    }
  }

  // ── 4. KYC provider call ──────────────────────────────────
  const provider = getConfiguredProvider();
  let providerRef: string | undefined;
  let autoStatus: KycEngineOutput["autoStatus"] = "pending";

  try {
    const providerResult = await provider.submitIdentity({
      idImageR2Key: r2Key,
      idNumber,
      artifactId,
      userId,
    });

    providerRef = providerResult.providerReference;

    // If block-level risk signals were detected (e.g., duplicate SHA-256,
    // ID number reuse), force manual review regardless of provider result
    const hasBlockSignal = signalScore >= SEVERITY_WEIGHT.block;

    if (hasBlockSignal) {
      autoStatus = "needs_manual_review";
    } else {
      autoStatus =
        providerResult.status === "approved"
          ? "approved"
          : providerResult.status === "rejected"
            ? "rejected"
            : "needs_manual_review";
    }

    // ── Passive liveness / face-match policies ──────────────
    // When the provider returns real scores, enforce thresholds
    // to auto-escalate or auto-reject weak biometrics.
    // Block signals (duplicate SHA-256, ID reuse) always force manual
    // review — biometric auto-reject must not override that.
    const { faceMatchScore, livenessScore } = providerResult.scores;

    if (typeof livenessScore === "number" && livenessScore < LIVENESS_THRESHOLD) {
      log.warn("Low liveness score — escalating to manual review", {
        livenessScore,
        threshold: LIVENESS_THRESHOLD,
        userId,
      });
      await writeSignal(adminClient, {
        userId,
        artifactId,
        signalCode: "low_liveness_score",
        severity: "warn",
        valueJson: { livenessScore, threshold: LIVENESS_THRESHOLD },
      });
      signalScore += SEVERITY_WEIGHT.warn;

      if (typeof faceMatchScore === "number" && faceMatchScore < FACE_MATCH_THRESHOLD) {
        // Both biometrics failed
        log.warn("Low liveness AND face-match — auto-rejecting", {
          livenessScore,
          faceMatchScore,
          userId,
        });
        await writeSignal(adminClient, {
          userId,
          artifactId,
          signalCode: "low_face_match_score",
          severity: "warn",
          valueJson: { faceMatchScore, threshold: FACE_MATCH_THRESHOLD },
        });
        signalScore += SEVERITY_WEIGHT.warn;
        // Only auto-reject if no block-level signals require manual review
        if (!hasBlockSignal) {
          autoStatus = "rejected";
        }
      } else {
        autoStatus = "needs_manual_review";
      }
    } else if (typeof faceMatchScore === "number" && faceMatchScore < FACE_MATCH_THRESHOLD) {
      log.warn("Low face-match score — escalating to manual review", {
        faceMatchScore,
        threshold: FACE_MATCH_THRESHOLD,
        userId,
      });
      await writeSignal(adminClient, {
        userId,
        artifactId,
        signalCode: "low_face_match_score",
        severity: "warn",
        valueJson: { faceMatchScore, threshold: FACE_MATCH_THRESHOLD },
      });
      signalScore += SEVERITY_WEIGHT.warn;
      autoStatus = "needs_manual_review";
    }

    // Persist provider result
    const { error: prError } = await adminClient.from("kyc_provider_results").insert({
      artifact_id: artifactId,
      user_id: userId,
      provider_name: provider.name,
      face_match_score: providerResult.scores.faceMatchScore,
      liveness_score: providerResult.scores.livenessScore,
      doc_auth_score: providerResult.scores.docAuthScore,
      ocr_payload: providerResult.scores.ocrPayload,
      raw_response: providerResult.scores.rawResponse,
      provider_status: providerResult.status,
      provider_ref: providerRef ?? null,
    });

    if (prError) {
      log.error("Failed to persist provider result", { error: prError.message });
    }
  } catch (err) {
    log.error("KYC provider call failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    autoStatus = "needs_manual_review";
  }

  // ── 5. EXIF-based fraud signals (file_upload only) ─────────
  if (exifSignals && captureMethod === "file_upload") {
    if (!exifSignals.hasExif) {
      log.warn("File-uploaded image has no EXIF data", { userId, stepType });
      await writeSignal(adminClient, {
        userId,
        artifactId,
        signalCode: "no_camera_exif",
        severity: "warn",
        valueJson: { captureMethod },
      });
      signalScore += SEVERITY_WEIGHT.warn;
    }

    if (exifSignals.software) {
      const editorPatterns = /photoshop|gimp|paint|snapseed|lightroom|canva|pixlr|affinity/i;
      if (editorPatterns.test(exifSignals.software)) {
        log.warn("EXIF software indicates image editor", {
          software: exifSignals.software,
          userId,
        });
        await writeSignal(adminClient, {
          userId,
          artifactId,
          signalCode: "software_edited",
          severity: "warn",
          valueJson: { software: exifSignals.software },
        });
        signalScore += SEVERITY_WEIGHT.warn;
      }
    }
  }

  // Stale photo check (regardless of capture method)
  if (exifSignals?.dateTime) {
    try {
      // EXIF date format: "YYYY:MM:DD HH:MM:SS"
      const exifDate = new Date(
        exifSignals.dateTime.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
      );
      const ageMs = Date.now() - exifDate.getTime();
      if (!isNaN(ageMs) && ageMs > 24 * 60 * 60 * 1000) {
        await writeSignal(adminClient, {
          userId,
          artifactId,
          signalCode: "stale_photo",
          severity: "info",
          valueJson: { dateTime: exifSignals.dateTime, ageHours: Math.round(ageMs / 3600000) },
        });
        // info = 0 pts, no score change
      }
    } catch {
      // Invalid date — skip
    }
  }

  // EXIF orientation signal (informational)
  if (exifSignals?.orientation != null && exifSignals.orientation !== 1) {
    await writeSignal(adminClient, {
      userId,
      artifactId,
      signalCode: "non_standard_orientation",
      severity: "info",
      valueJson: { orientation: exifSignals.orientation },
    });
    // info = 0 pts, no score change — useful for admin review context
  }

  // ── 6. Selfie not captured via camera signal ──────────────
  if (stepType === "selfie" && captureMethod === "file_upload") {
    log.warn("Selfie uploaded via file instead of camera", { userId });
    await writeSignal(adminClient, {
      userId,
      artifactId,
      signalCode: "selfie_not_camera_captured",
      severity: "warn",
      valueJson: { captureMethod },
    });
    signalScore += SEVERITY_WEIGHT.warn;
  }

  // ── 7. Blur detection signal ──────────────────────────────
  if (typeof blurScore === "number" && blurScore < BLUR_VARIANCE_THRESHOLD) {
    log.warn("Blurry image detected", { userId, blurScore });
    await writeSignal(adminClient, {
      userId,
      artifactId,
      signalCode: "blurry_image",
      severity: "warn",
      valueJson: { blurScore, threshold: BLUR_VARIANCE_THRESHOLD },
    });
    signalScore += SEVERITY_WEIGHT.warn;
  }

  // ── 8. Rapid step completion (phone → upload < 30s) ───────
  {
    const { data: session } = await adminClient
      .from("verification_sessions")
      .select("phone_verified_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (session?.phone_verified_at) {
      const phoneVerifiedAt = new Date(session.phone_verified_at).getTime();
      const elapsed = Date.now() - phoneVerifiedAt;
      if (!isNaN(elapsed) && elapsed < 30_000) {
        log.warn("Rapid step completion detected", { userId, elapsedMs: elapsed });
        await writeSignal(adminClient, {
          userId,
          artifactId,
          signalCode: "rapid_step_completion",
          severity: "warn",
          valueJson: { elapsedMs: elapsed },
        });
        signalScore += SEVERITY_WEIGHT.warn;
      }
    }
  }

  // ── 8b. Phone linked to flagged account ────────────────────
  if (phoneFlagged) {
    signalScore += SEVERITY_WEIGHT.block;
  }

  // ── 9. Aggregate risk score ───────────────────────────────
  const riskScore = Math.min(signalScore, 100);
  const riskLevel = deriveRiskLevel(riskScore);

  // Re-evaluate block-level signals against the FINAL aggregate score. The
  // provider-time decision above only saw the signals known at that point —
  // a block-severity signal added later (e.g. phone linked to a flagged
  // account) must never leave an auto-approved/auto-rejected verdict standing.
  if (signalScore >= SEVERITY_WEIGHT.block && autoStatus !== "needs_manual_review") {
    log.warn("Block-severity signal present — forcing manual review over provider verdict", {
      userId,
      artifactId,
      signalScore,
      previousAutoStatus: autoStatus,
    });
    autoStatus = "needs_manual_review";
  }

  log.info("KYC engine complete", { artifactId, riskScore, riskLevel, autoStatus });

  return {
    sha256,
    phash: phash ?? null,
    riskScore,
    riskLevel,
    providerRef,
    autoStatus,
    idNumberHmac,
  };
}

// ── Internal helper ───────────────────────────────────────────

async function writeSignal(
  adminClient: SupabaseClient,
  signal: {
    userId: string;
    artifactId: string;
    signalCode: string;
    severity: "info" | "warn" | "block";
    valueJson: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await adminClient.from("kyc_risk_signals").insert({
    user_id: signal.userId,
    artifact_id: signal.artifactId,
    signal_code: signal.signalCode,
    severity: signal.severity,
    value_json: signal.valueJson,
  });
  if (error) {
    log.error("Failed to write risk signal", {
      signalCode: signal.signalCode,
      error: error.message,
    });
  }
}
