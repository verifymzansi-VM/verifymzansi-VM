import { LiveCheckError, readLiveJson, retryLiveCheck, type LiveRetryOptions } from "./live-retry";

export function readinessUrl(baseUrl: string, override?: string): URL {
  const url = override ? new URL(override) : new URL("/api/health", baseUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw new LiveCheckError("Invalid health URL protocol");
  url.searchParams.set("deep", "1");
  return url;
}

export async function checkDeploymentHealth(
  url: URL,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImpl(url, {
    redirect: "error",
    headers: { Accept: "application/json", "User-Agent": "VerifyMzansi-Deploy-Healthcheck/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw new LiveCheckError(`Readiness returned HTTP ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel().catch(() => {});
    throw new LiveCheckError("Readiness did not return JSON (possible edge challenge)");
  }
  const body = (await readLiveJson(response, "Readiness returned malformed JSON")) as {
    status?: unknown;
    readiness?: unknown;
  } | null;
  if (body?.status !== "ok" || body?.readiness !== "ok") {
    throw new LiveCheckError("Deployment is not ready");
  }
}

/**
 * A freshly deployed worker starts cold, and the deep snapshot can exceed its
 * in-route timeout on the first requests (observed: 503 at ~2.5s cold, 200 at
 * ~0.5s warm). Retry a bounded number of times so a cold start does not roll
 * back a healthy deploy, while a persistently degraded deploy still fails.
 */
export async function waitForDeploymentHealth(
  url: URL,
  { fetchImpl = fetch, ...retry }: LiveRetryOptions & { fetchImpl?: typeof fetch } = {}
): Promise<number> {
  return retryLiveCheck(() => checkDeploymentHealth(url, fetchImpl), retry);
}
