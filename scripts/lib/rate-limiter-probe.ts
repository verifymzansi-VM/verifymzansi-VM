import { LiveCheckError, PermanentLiveCheckError, readLiveJson } from "./live-retry";

export const RATE_LIMITER_URL = "https://verifymzansi-rate-limiter.verifymzansi.workers.dev/";

/** Check a shared key against the deployed rate limiter. The Worker implements
 * readOnly without incrementing any counters, so a repeat is harmless. The
 * destination is fixed here, before the credential is attached. */
export async function checkRateLimiterKey(key: string, fetchImpl: typeof fetch = fetch) {
  // Printable ASCII only: a control character in a header value makes fetch
  // throw an error whose message repeats the whole value.
  if (!/^[!-~]{1,512}$/.test(key)) throw new PermanentLiveCheckError("Rate limiter key is invalid");
  const response = await fetchImpl(RATE_LIMITER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key: "health:probe", action: "businesses:read", readOnly: true }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) {
    await response.body?.cancel().catch(() => {});
    // A refused key is a definitive answer; do not keep presenting it.
    throw new PermanentLiveCheckError("Rate limiter refused the key");
  }
  if (!response.ok) await response.body?.cancel().catch(() => {});
  const body = response.ok
    ? ((await readLiveJson(response, "Rate limiter probe returned malformed JSON")) as {
        ok?: unknown;
      } | null)
    : null;
  if (body?.ok !== true)
    throw new LiveCheckError(`Rate limiter probe returned HTTP ${response.status}`);
}
