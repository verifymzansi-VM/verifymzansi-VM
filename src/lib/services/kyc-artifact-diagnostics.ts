/**
 * KYC Artifact Diagnostics
 * Utilities for detecting, tracking, and recovering from missing KYC evidence files.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("KycArtifactDiagnostics");

export interface ArtifactMissingReport {
  artifactId: string;
  userId: string;
  stepType: string;
  r2Key: string;
  status: string;
  createdAt: string;
  purgeAfter: string | null;
  hasFallback: boolean;
  fallbackCount: number;
}

/**
 * Check if a KYC artifact's R2 file is missing by attempting download.
 * Returns true if the file is missing, false if it exists.
 */
export async function isArtifactMissingInStorage(
  downloadFn: (key: string) => Promise<Buffer>,
  r2Key: string
): Promise<boolean> {
  try {
    await downloadFn(r2Key);
    return false; // Successfully downloaded
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Check if it's a "not found" error vs other types of errors
    return /not found|no such key|nosuchkey|404|does not exist/i.test(message);
  }
}

/**
 * Scan a user's KYC artifacts to identify which ones might be missing from storage.
 * Useful for diagnostics and reporting.
 */
export async function scanUserArtifactsForMissing(
  adminClient: SupabaseClient,
  userId: string
): Promise<ArtifactMissingReport[]> {
  const { data: artifacts, error: queryError } = await adminClient
    .from("kyc_artifacts")
    .select("id, user_id, step_type, r2_key, status, created_at, purge_after")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (queryError || !artifacts) {
    log.error("Failed to scan user artifacts", { userId, error: queryError });
    return [];
  }

  const reports: ArtifactMissingReport[] = [];

  for (const artifact of artifacts) {
    // Count how many fallback artifacts exist for this step type
    const { count: fallbackCount } = await adminClient
      .from("kyc_artifacts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("step_type", artifact.step_type)
      .neq("id", artifact.id);

    reports.push({
      artifactId: artifact.id,
      userId: artifact.user_id,
      stepType: artifact.step_type,
      r2Key: artifact.r2_key,
      status: artifact.status,
      createdAt: artifact.created_at,
      purgeAfter: artifact.purge_after,
      hasFallback: (fallbackCount ?? 0) > 0,
      fallbackCount: fallbackCount ?? 0,
    });
  }

  return reports;
}

/**
 * Get diagnostic info about why an artifact download might be failing.
 * Distinguishes between missing files, decryption errors, and other issues.
 */
export function diagnoseDownloadFailure(error: unknown): {
  type: "missing_file" | "decryption_error" | "corruption" | "network_error" | "unknown";
  message: string;
  isRecoverable: boolean;
} {
  const message = error instanceof Error ? error.message : String(error);

  if (/not found|no such key|nosuchkey|404|does not exist/i.test(message)) {
    return {
      type: "missing_file",
      message: "File is missing from storage",
      isRecoverable: false, // Unless we have a fallback
    };
  }

  if (/decrypt|cipher|decipher|invalid auth|auth.*fail/i.test(message)) {
    return {
      type: "decryption_error",
      message: "Failed to decrypt artifact",
      isRecoverable: false, // Data is corrupted
    };
  }

  if (/corrupt|invalid|malformed/i.test(message)) {
    return {
      type: "corruption",
      message: "Artifact appears corrupted",
      isRecoverable: false,
    };
  }

  if (/network|timeout|econnrefused|enotfound/i.test(message)) {
    return {
      type: "network_error",
      message: "Network error accessing storage",
      isRecoverable: true, // Retry may help
    };
  }

  return {
    type: "unknown",
    message: String(message),
    isRecoverable: false,
  };
}

/**
 * Report a missing artifact to help with monitoring and debugging.
 * Logs comprehensive diagnostic info that can be analyzed later.
 */
export function reportMissingArtifact(
  report: ArtifactMissingReport,
  diagnosis: ReturnType<typeof diagnoseDownloadFailure>
): void {
  log.error("KYC artifact access failed", {
    artifactId: report.artifactId,
    userId: report.userId,
    stepType: report.stepType,
    r2Key: report.r2Key.slice(0, 60), // Truncate for logs
    status: report.status,
    createdAt: report.createdAt,
    purgeAfter: report.purgeAfter,
    hasFallback: report.hasFallback,
    fallbackCount: report.fallbackCount,
    errorType: diagnosis.type,
    errorMessage: diagnosis.message,
    isRecoverable: diagnosis.isRecoverable,
  });
}
