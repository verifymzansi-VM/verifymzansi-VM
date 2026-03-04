import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { getConfiguredProvider } from "./kyc-provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RiskLevel } from "@/types/enums";

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
}

export interface KycEngineOutput {
  sha256: string;
  riskScore: number;
  riskLevel: RiskLevel;
  providerRef: string | undefined;
  autoStatus: "pending" | "approved" | "rejected" | "needs_manual_review";
  idNumberHmac: string | undefined;
}

/**
 * Processes a newly uploaded KYC artifact:
 * 1. Computes SHA-256 and checks for duplicate submissions across accounts.
 * 2. Checks upload velocity (≥4 attempts in 24h for same step type).
 * 3. Checks ID number HMAC reuse across accounts (id_doc only).
 * 4. Calls the configured KYC provider and persists the result.
 * 5. Aggregates signals into a risk score and level.
 *
 * Returns scoring data to be written to the verification_steps and
 * kyc_artifacts rows by the caller.
 */
export async function processKycArtifact(input: KycEngineInput): Promise<KycEngineOutput> {
  const { artifactId, userId, stepType, fileBuffer, r2Key, idNumber, adminClient } = input;
  let signalScore = 0;

  // ── 1. SHA-256 deduplication ──────────────────────────────
  const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  const { data: dupRows } = await adminClient
    .from("kyc_artifacts")
    .select("id, user_id")
    .eq("sha256", sha256)
    .neq("user_id", userId)
    .limit(1);

  if (dupRows && dupRows.length > 0) {
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

  // ── 2. Velocity check (atomic, race-safe via DB advisory lock) ──
  const { data: velocityOk, error: velocityErr } = await adminClient.rpc("check_kyc_velocity", {
    p_user_id: userId,
    p_step_type: stepType,
  });

  if (velocityErr) {
    log.error("Velocity check RPC failed", { error: velocityErr.message });
    // Fail open with a warning signal rather than blocking uploads
    await writeSignal(adminClient, {
      userId,
      artifactId,
      signalCode: "velocity_check_error",
      severity: "warn",
      valueJson: { error: velocityErr.message },
    });
    signalScore += SEVERITY_WEIGHT.warn;
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
    if (!hmacSecret || hmacSecret === ZERO_KEY || hmacSecret === CAFEBABE_PLACEHOLDER) {
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

      const { data: hmacRows } = await adminClient
        .from("verification_steps")
        .select("id, user_id")
        .eq("id_number_hmac", idNumberHmac)
        .neq("user_id", userId)
        .limit(1);

      if (hmacRows && hmacRows.length > 0) {
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

  // ── 5. Aggregate risk score ───────────────────────────────
  const riskScore = Math.min(signalScore, 100);
  const riskLevel = deriveRiskLevel(riskScore);

  log.info("KYC engine complete", { artifactId, riskScore, riskLevel, autoStatus });

  return { sha256, riskScore, riskLevel, providerRef, autoStatus, idNumberHmac };
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
