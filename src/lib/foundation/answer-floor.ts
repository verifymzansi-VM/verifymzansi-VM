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
  const jitter = jitterMs > 0 ? crypto.getRandomValues(new Uint32Array(1))[0] % (jitterMs + 1) : 0;
  const wait = startedAt + floorMs + jitter - now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
