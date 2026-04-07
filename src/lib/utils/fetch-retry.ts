import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FetchRetry");

/**
 * Execute a fetch with a single automatic retry on network errors (TypeError).
 * Mobile connections (especially Android on LTE) can drop momentarily; one
 * retry recovers most transient failures without annoying the user.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof TypeError) {
      log.warn("Network error during fetch, retrying once", {
        message: err.message,
      });
      return fetch(input, init);
    }
    throw err;
  }
}
