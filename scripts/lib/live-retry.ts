/** A live check failure whose message is fixed text, safe to print in CI logs. */
export class LiveCheckError extends Error {
  override name = "LiveCheckError";
}

/** A definitive answer that waiting cannot change, such as a wrong backend
 * identity or a refused credential. The retry loop stops on the first one. */
export class PermanentLiveCheckError extends LiveCheckError {
  override name = "PermanentLiveCheckError";
}

/** Describe a failure for a log line. Only this module's fixed messages are
 * printed; anything else (network errors can carry URLs or provider text) is
 * reduced to a generic class. */
export function liveCheckFailureReason(error: unknown): string {
  if (error instanceof LiveCheckError) return error.message;
  if (isTimeout(error)) return "request timed out";
  return "request failed";
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** Read a JSON body; a timeout stays a timeout, anything else is `malformed`. */
export async function readLiveJson(response: Response, malformed: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (isTimeout(error)) throw error;
    throw new LiveCheckError(malformed);
  }
}

export type LiveRetryOptions = {
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
};

/**
 * Workers deployed moments earlier start cold, and their first requests can
 * miss an in-route timeout (observed: 503 at ~2.5 s cold, 200 at ~0.5 s warm).
 * Run a live check a bounded number of times so a cold start does not fail a
 * healthy deploy, while a persistently failing check, or any permanent
 * failure, still fails. Returns the attempt that passed.
 */
export async function retryLiveCheck(
  run: () => Promise<unknown>,
  {
    attempts = 6,
    delayMs = 10_000,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    onRetry,
  }: LiveRetryOptions = {}
): Promise<number> {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10)
    throw new Error("Live check attempts must be between 1 and 10");
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 60_000)
    throw new Error("Live check delay must be between 0 and 60 seconds");
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await run();
      return attempt;
    } catch (error) {
      lastError = error;
      if (error instanceof PermanentLiveCheckError) break;
      if (attempt < attempts) {
        onRetry?.(attempt, error);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}
