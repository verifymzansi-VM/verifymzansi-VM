import type { Logger } from "./logger";

/**
 * Fallbacks to default values: a read failed and the code carried on with
 * defaults. Every fallback is counted; a warning with a stable name and the
 * running count is logged for the first one and then at most once every five
 * minutes per fallback, so a read that fails on every visit cannot flood the
 * logs (for example staff-edited settings being ignored because their read
 * fails).
 *
 * Counts are per Worker isolate: they show a fallback is recurring, not an
 * exact total. Search the logs for `"event":"fallback_to_default"`.
 */

type DefaultFallback = "commercial_settings";

const LOG_INTERVAL_MS = 5 * 60_000;
const counts = new Map<DefaultFallback, number>();
const loggedAt = new Map<DefaultFallback, number>();

export function recordDefaultFallback(
  log: Logger,
  fallback: DefaultFallback,
  details: { errorCode?: string; usedCachedValue?: boolean } = {},
  now: number = Date.now()
): number {
  const count = (counts.get(fallback) ?? 0) + 1;
  counts.set(fallback, count);
  const last = loggedAt.get(fallback);
  if (last !== undefined && now - last < LOG_INTERVAL_MS) return count;
  loggedAt.set(fallback, now);
  log.warn("Using default values after a failed read", {
    event: "fallback_to_default",
    fallback,
    count,
    ...(details.errorCode ? { errorCode: details.errorCode } : {}),
    ...(details.usedCachedValue !== undefined ? { usedCachedValue: details.usedCachedValue } : {}),
  });
  return count;
}

export function defaultFallbackCount(fallback: DefaultFallback): number {
  return counts.get(fallback) ?? 0;
}

/** Tests only: forget when each fallback was last logged. */
export function resetFallbackLogTimesForTests(): void {
  loggedAt.clear();
}
