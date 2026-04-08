import { createLogger } from "@/lib/utils/logger";
import { fetchWithRetry } from "@/lib/utils/fetch-retry";

const log = createLogger("UploadPreflight");

const PREFLIGHT_TIMEOUT_MS = 12_000;

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
 * Create a timeout AbortSignal that works on older mobile browsers where
 * `AbortSignal.timeout` is unavailable (iOS Safari < 17.4).
 */
function safeTimeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("TimeoutError", "TimeoutError")), ms);
  return controller.signal;
}

/**
 * Lightweight preflight check to verify the upload API is reachable before
 * attempting a full upload.  Sends a small HEAD request to /api/media/upload.
 * Throws {@link UploadServiceUnreachableError} only on network/timeout failure.
 *
 * Uses {@link fetchWithRetry} (2 retries with exponential back-off) and a
 * browser-compatible timeout signal to cope with flaky mobile connections
 * and older iOS versions that lack `AbortSignal.timeout`.
 *
 * A 5xx response means the edge is reachable but currently degraded. In that
 * case we log and continue so callers can make one real upload attempt instead
 * of blocking immediately on a transient preflight failure.
 */
export async function checkUploadServiceReachable(): Promise<void> {
  try {
    const res = await fetchWithRetry("/api/media/upload", {
      method: "HEAD",
      signal: safeTimeoutSignal(PREFLIGHT_TIMEOUT_MS),
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
