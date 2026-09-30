/**
 * Deadline for each server-side supabase-js HTTP request (PostgREST, GoTrue,
 * Storage list/remove). Server code never streams large bodies through
 * supabase-js — media goes to R2 via src/lib/services/storage.ts — so a
 * single request that has not answered in this window is treated as hung
 * rather than slow. Without a deadline a stalled connection holds the Worker
 * request open until the platform kills it.
 */
const SUPABASE_FETCH_TIMEOUT_MS = 15_000;

function combineSignals(timeout: AbortSignal, caller?: AbortSignal | null): AbortSignal {
  if (!caller) return timeout;
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  // Runtimes without AbortSignal.any keep the caller's own cancellation.
  return typeof anyFn === "function" ? anyFn.call(AbortSignal, [caller, timeout]) : caller;
}

/**
 * Build a `fetch` for supabase-js `global.fetch` that aborts after
 * `timeoutMs`, while still honouring any signal supabase-js passes itself
 * (e.g. `.abortSignal()`). Resolves `globalThis.fetch` at call time so
 * runtime/test replacements of fetch keep working.
 */
export function createTimeoutFetch(timeoutMs: number = SUPABASE_FETCH_TIMEOUT_MS): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, {
      ...init,
      signal: combineSignals(AbortSignal.timeout(timeoutMs), init?.signal),
    });
}
