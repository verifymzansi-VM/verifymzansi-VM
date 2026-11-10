import type { Logger } from "./logger";

/**
 * Fallbacks to default values: a read failed and the code carried on with
 * defaults. Each one logs a warning with a stable name and a running count, so
 * repeated fallbacks show up in the Worker logs instead of passing unnoticed
 * (for example staff-edited settings being ignored because their read fails).
 *
 * Counts are per Worker isolate: they show a fallback is recurring, not an
 * exact total. Search the logs for `"event":"fallback_to_default"`.
 */

type DefaultFallback = "commercial_settings";

const counts = new Map<DefaultFallback, number>();

export function recordDefaultFallback(
  log: Logger,
  fallback: DefaultFallback,
  details: { errorCode?: string; usedCachedValue?: boolean } = {}
): number {
  const count = (counts.get(fallback) ?? 0) + 1;
  counts.set(fallback, count);
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
