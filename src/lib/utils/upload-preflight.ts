import { createLogger } from "@/lib/utils/logger";

const log = createLogger("UploadPreflight");

export class UploadServiceUnreachableError extends Error {
  constructor(detail?: string) {
    super(
      detail
        ? `Upload service is not reachable: ${detail}`
        : "Upload service is not reachable. Check your connection and try again."
    );
    this.name = "UploadServiceUnreachableError";
  }
}

/**
 * Lightweight preflight check to verify the upload API is reachable before
 * attempting a full upload.  Sends a small HEAD request to /api/media/upload.
 * Throws {@link UploadServiceUnreachableError} only on network/timeout failure.
 *
 * A 5xx response means the edge is reachable but currently degraded. In that
 * case we log and continue so callers can make one real upload attempt instead
 * of blocking immediately on a transient preflight failure.
 */
export async function checkUploadServiceReachable(): Promise<void> {
  try {
    const res = await fetch("/api/media/upload", {
      method: "HEAD",
      // Short timeout — we only need to know the server is alive.
      signal: AbortSignal.timeout(8_000),
    });

    // Any HTTP response (even 401/405) means the server is reachable.
    // Network-level failures throw instead of returning a Response.
    if (res.status >= 500) {
      log.warn("Upload preflight returned server error; allowing live upload attempt", {
        status: res.status,
      });
      return;
    }
  } catch (err) {
    if (err instanceof UploadServiceUnreachableError) {
      throw err;
    }

    log.warn("Upload preflight failed", {
      message: err instanceof Error ? err.message : String(err),
    });

    throw new UploadServiceUnreachableError();
  }
}
