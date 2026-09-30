/**
 * Deadline for each server-side supabase-js HTTP request (PostgREST, GoTrue,
 * Storage list/remove). Server code never streams large bodies through
 * supabase-js — media goes to R2 via src/lib/services/storage.ts — so a
 * single request that has not answered in this window is treated as hung
 * rather than slow. Without a deadline a stalled connection holds the Worker
 * request open until the platform kills it.
 */
const SUPABASE_FETCH_TIMEOUT_MS = 15_000;

function combineSignals(
  timeout: AbortSignal,
  caller?: AbortSignal | null
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  if (!caller) return { signal: timeout, cleanup: () => {} };
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    return { signal: anyFn.call(AbortSignal, [caller, timeout]), cleanup: () => {} };
  }

  // Older runtimes must still enforce the deadline when a caller has supplied
  // cancellation. Preserve the first abort reason and release both listeners.
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(caller.reason);
  const onTimeoutAbort = () => controller.abort(timeout.reason);
  if (caller.aborted) onCallerAbort();
  else if (timeout.aborted) onTimeoutAbort();
  else {
    caller.addEventListener("abort", onCallerAbort, { once: true });
    timeout.addEventListener("abort", onTimeoutAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      caller.removeEventListener("abort", onCallerAbort);
      timeout.removeEventListener("abort", onTimeoutAbort);
    },
  };
}

/**
 * Build a `fetch` for supabase-js `global.fetch` that aborts after
 * `timeoutMs`, while still honouring any signal supabase-js passes itself
 * (e.g. `.abortSignal()`). Resolves `globalThis.fetch` at call time so
 * runtime/test replacements of fetch keep working.
 */
export function createTimeoutFetch(timeoutMs: number = SUPABASE_FETCH_TIMEOUT_MS): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const combined = combineSignals(AbortSignal.timeout(timeoutMs), callerSignal);
    try {
      return await globalThis.fetch(input, { ...init, signal: combined.signal });
    } finally {
      combined.cleanup();
    }
  };
}
