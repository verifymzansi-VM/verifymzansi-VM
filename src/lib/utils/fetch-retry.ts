import { createLogger } from "@/lib/utils/logger";

const log = createLogger("FetchRetry");

const DEFAULT_MAX_RETRIES = 2;
const BASE_DELAY_MS = 600;
const DEFAULT_TIMEOUT_MS = 45_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("The operation was aborted", "AbortError"));
  }, ms);

  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeoutId),
  };
}

function combineSignals(
  callerSignal: AbortSignal | null | undefined,
  timeoutSignal: AbortSignal
): { signal: AbortSignal; wasCallerAbort: () => boolean; cleanup: () => void } {
  if (!callerSignal) {
    return {
      signal: timeoutSignal,
      wasCallerAbort: () => false,
      cleanup: () => {},
    };
  }

  if (typeof AbortSignal.any === "function") {
    const callerAborted = () => callerSignal.aborted;
    return {
      signal: AbortSignal.any([callerSignal, timeoutSignal]),
      wasCallerAbort: callerAborted,
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  let callerAborted = callerSignal.aborted;

  const abortFrom = (signal: AbortSignal, markCallerAbort: boolean) => {
    if (markCallerAbort) {
      callerAborted = true;
    }
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  if (callerSignal.aborted) {
    abortFrom(callerSignal, true);
  } else if (timeoutSignal.aborted) {
    abortFrom(timeoutSignal, false);
  }

  const onCallerAbort = () => abortFrom(callerSignal, true);
  const onTimeoutAbort = () => abortFrom(timeoutSignal, false);

  callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  timeoutSignal.addEventListener("abort", onTimeoutAbort, { once: true });

  return {
    signal: controller.signal,
    wasCallerAbort: () => callerAborted,
    cleanup: () => {
      callerSignal.removeEventListener("abort", onCallerAbort);
      timeoutSignal.removeEventListener("abort", onTimeoutAbort);
    },
  };
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
  maxRetries: number = DEFAULT_MAX_RETRIES,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeout = createTimeoutSignal(timeoutMs);
    const combinedSignal = combineSignals(init?.signal, timeout.signal);

    try {
      return await fetch(input, { ...init, signal: combinedSignal.signal });
    } catch (err) {
      lastError = err;
      if (combinedSignal.wasCallerAbort() || !isRetryable(err) || attempt === maxRetries) {
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
    } finally {
      combinedSignal.cleanup();
      timeout.cancel();
    }
  }

  throw lastError;
}
