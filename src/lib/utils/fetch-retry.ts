import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FetchRetry");

const DEFAULT_MAX_RETRIES = 2;
const BASE_DELAY_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a fetch with automatic retries on network errors (TypeError).
 * Uses exponential back-off: 600 ms → 1 200 ms.
 * Mobile connections (especially Android on LTE) can drop momentarily;
 * retries recover most transient failures without annoying the user.
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
      if (!(err instanceof TypeError) || attempt === maxRetries) {
        break;
      }
      const backoff = BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn("Network error during fetch, retrying", {
        message: err.message,
        attempt: attempt + 1,
        maxRetries,
        nextDelayMs: backoff,
      });
      await delay(backoff);
    }
  }

  throw lastError;
}
