import { createLogger } from "@/lib/utils/logger";

const log = createLogger("UploadPreflight");

const PREFLIGHT_TIMEOUT_MS = 12_000;
const MAX_PREFLIGHT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 800;

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

function isRetryableError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lightweight preflight check to verify the upload API is reachable before
 * attempting a full upload.  Sends a small HEAD request to /api/media/upload.
 * Throws {@link UploadServiceUnreachableError} only on network/timeout failure.
 *
 * Each attempt gets its own fresh timeout signal so slow-network retries are
 * not starved by a shared clock.  Retries cover both network errors (TypeError)
 * and timeouts (DOMException/AbortError) with exponential back-off.
 *
 * A 5xx response means the edge is reachable but currently degraded. In that
 * case we log and continue so callers can make one real upload attempt instead
 * of blocking immediately on a transient preflight failure.
 */
export async function checkUploadServiceReachable(): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_PREFLIGHT_RETRIES; attempt++) {
    try {
      // Fresh timeout per attempt so retries get the full window
      const res = await fetch("/api/media/upload", {
        method: "HEAD",
        signal: safeTimeoutSignal(PREFLIGHT_TIMEOUT_MS),
      });

      // Any HTTP response (even 401/405) means the server is reachable.
      if (res.status >= 500) {
        log.warn("Upload preflight returned server error; allowing live upload attempt", {
          status: res.status,
        });
      }
      return; // success — server is alive
    } catch (err) {
      lastError = err;

      if (!isRetryableError(err) || attempt === MAX_PREFLIGHT_RETRIES) {
        break;
      }

      const backoff = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn("Upload preflight failed, retrying", {
        message: err instanceof Error ? err.message : String(err),
        attempt: attempt + 1,
        maxRetries: MAX_PREFLIGHT_RETRIES,
        nextDelayMs: backoff,
      });
      await delay(backoff);
    }
  }

  log.warn("Upload preflight failed after retries", {
    message: lastError instanceof Error ? lastError.message : String(lastError),
  });

  throw new UploadServiceUnreachableError();
}
