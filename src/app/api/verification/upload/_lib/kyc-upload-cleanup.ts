import type { createAdminClient } from "@/lib/supabase/admin";
import { deleteFromR2 } from "@/lib/services/storage";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("VerificationUploadCleanup");
const R2_CLEANUP_RETRY_DELAYS_MS = [0, 75, 150] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function cleanupUploadedR2Object(params: {
  bucket: string;
  key: string;
  requestId: string;
  reason: string;
}): Promise<boolean> {
  for (let attempt = 0; attempt < R2_CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = R2_CLEANUP_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      await deleteFromR2(params.bucket, params.key);

      if (attempt > 0) {
        log.warn("R2 cleanup succeeded after retry", {
          requestId: params.requestId,
          r2Key: params.key,
          reason: params.reason,
          attempts: attempt + 1,
        });
      }

      return true;
    } catch (error) {
      const details = {
        requestId: params.requestId,
        r2Key: params.key,
        reason: params.reason,
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
      };

      if (attempt === R2_CLEANUP_RETRY_DELAYS_MS.length - 1) {
        log.error("CRITICAL: Failed to clean up orphaned R2 file after retries", details);
        return false;
      }

      log.warn("R2 cleanup attempt failed; retrying", details);
    }
  }

  return false;
}

export async function cleanupPersistedKycUpload(params: {
  admin: ReturnType<typeof createAdminClient>;
  artifactId: string;
  bucket: string;
  key: string;
  requestId: string;
  reason: string;
  uploadedToR2: boolean;
}): Promise<void> {
  try {
    const { error } = await params.admin.from("kyc_artifacts").delete().eq("id", params.artifactId);
    if (error) {
      log.error("CRITICAL: Failed to clean up rejected kyc_artifact row", {
        artifactId: params.artifactId,
        requestId: params.requestId,
        reason: params.reason,
        error: error.message,
      });
    }
  } catch (error) {
    log.error("CRITICAL: Failed to clean up rejected kyc_artifact row", {
      artifactId: params.artifactId,
      requestId: params.requestId,
      reason: params.reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (params.uploadedToR2) {
    await cleanupUploadedR2Object({
      bucket: params.bucket,
      key: params.key,
      requestId: params.requestId,
      reason: params.reason,
    });
  }
}
