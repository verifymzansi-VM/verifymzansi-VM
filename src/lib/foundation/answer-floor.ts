/** The largest jitter supported: random values are taken 10 bits at a time. */
const MAX_JITTER_MS = 0x3ff;

/** A uniform whole number from 0 to `max` (at most MAX_JITTER_MS): 10 random
 * bits, drawn again while they exceed `max` (no modulo or scaling bias). */
function uniformUpTo(max: number) {
  for (;;) {
    const value = crypto.getRandomValues(new Uint16Array(1))[0] & 0x3ff;
    if (value <= max) return value;
  }
}

/**
 * Holds an answer until at least `floorMs` (plus up to `jitterMs` at random)
 * have passed since `startedAt`, so its timing does not show which of several
 * outcomes produced it (for example whether Auth sent emails or refused at
 * once). It never shortens anything that already took longer.
 */
export async function holdAnswer(
  startedAt: number,
  { floorMs, jitterMs }: { floorMs: number; jitterMs: number },
  now: () => number = Date.now
) {
  if (!Number.isInteger(jitterMs) || jitterMs < 0 || jitterMs > MAX_JITTER_MS)
    throw new RangeError("Unsupported answer jitter");
  const jitter = jitterMs > 0 ? uniformUpTo(jitterMs) : 0;
  const wait = startedAt + floorMs + jitter - now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
