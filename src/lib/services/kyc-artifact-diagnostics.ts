/**
 * KYC Artifact Diagnostics
 * Utilities for detecting, tracking, and recovering from missing KYC evidence files.
 */

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
