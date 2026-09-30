export function readinessUrl(baseUrl: string, override?: string): URL {
  const url = override ? new URL(override) : new URL("/api/health", baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid health URL protocol");
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
  if (response.status !== 200) throw new Error(`Readiness returned HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Readiness did not return JSON (possible edge challenge)");
  }
  const body = await response.json();
  if (body?.status !== "ok" || body?.readiness !== "ok") {
    throw new Error("Deployment is not ready");
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
  {
    attempts = 6,
    delayMs = 10_000,
    fetchImpl = fetch,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    onRetry,
  }: {
    attempts?: number;
    delayMs?: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {}
): Promise<number> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await checkDeploymentHealth(url, fetchImpl);
      return attempt;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        onRetry?.(attempt, error);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}
