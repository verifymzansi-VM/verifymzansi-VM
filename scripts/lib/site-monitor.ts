import { z } from "zod";

export const SITE_MONITOR_URL = "https://verifymzansi-site-monitor.verifymzansi.workers.dev/";

const homepageReport = z.object({
  status: z.literal("ok"),
  readiness: z.literal("ok"),
  scope: z.literal("live-service-smoke"),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["PASS", "FAIL"]),
      httpStatus: z.number(),
      projectHosts: z.array(z.string()).optional(),
    })
  ),
});

/** Verify live origin HTML without trusting a public edge challenge or stale cache.
 * The monitor probes the active APP binding and returns hostnames, never HTML or keys.
 * Public edge/browser checks remain separate from this backend identity proof. */
export async function checkSiteMonitorHomepage(
  env: Readonly<Record<string, string | undefined>>,
  expectedHostname: string,
  fetchImpl: typeof fetch = fetch
) {
  const { url, fetcher } = siteMonitorTransport(env, fetchImpl);
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Live homepage monitor is unavailable or degraded");
  const report = homepageReport.parse(await response.json());
  const homepages = report.checks.filter((check) => check.name === "Homepage");
  const homepage = homepages[0];
  if (
    homepages.length !== 1 ||
    !homepage ||
    homepage.status !== "PASS" ||
    homepage.httpStatus !== 200 ||
    homepage.projectHosts?.length !== 1 ||
    homepage.projectHosts[0] !== expectedHostname
  )
    throw new Error("Live homepage does not identify only the approved backend");
}

/** The scoped credential is sent only to this account's fixed monitor URL. */
export function siteMonitorTransport(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = fetch
) {
  const configured = env.SITE_MONITOR_URL || SITE_MONITOR_URL;
  const key = env.SITE_MONITOR_API_KEY;
  if (!key || key.length < 32 || key !== key.trim() || configured !== SITE_MONITOR_URL)
    throw new Error("Site monitor configuration is missing or invalid");
  if (env.SITE_MONITOR_WORKER_VERSION) throw new Error("Monitor verifies live traffic only");
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    );
    if (
      url.origin !== new URL(SITE_MONITOR_URL).origin ||
      url.pathname !== "/" ||
      url.username ||
      url.password
    )
      throw new Error("Refusing monitor credential destination");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${key}`);
    return fetchImpl(input, { ...init, headers, redirect: "error" });
  };
  return { url: new URL(configured), fetcher };
}
