import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FetchRetry");

const DEFAULT_MAX_RETRIES = 2;
const BASE_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true for errors that indicate a transient network / timeout problem
 * where a retry is likely to help.
 *
 * - TypeError  – network failures ("Failed to fetch")
 * - AbortError – timeout signals on mobile browsers
 */
function isRetryable(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError");
}

/**
 * Execute a fetch with automatic retries on network and timeout errors.
 * Uses exponential back-off: 600 ms → 1 200 ms.
 * Mobile connections (especially Android on LTE / iOS Safari) can drop
 * momentarily or time out; retries recover most transient failures.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxRetries) {
        break;
      }
      const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn("Network error during fetch, retrying", {
        message: err instanceof Error ? err.message : String(err),
        attempt: attempt + 1,
        maxRetries,
        nextDelayMs: backoff,
      });
      await delay(backoff);
    }
  }

  throw lastError;
}
