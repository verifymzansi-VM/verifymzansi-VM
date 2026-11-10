import { z } from "zod";
import {
  LiveCheckError,
  PermanentLiveCheckError,
  readLiveJson,
  retryLiveCheck,
  type LiveRetryOptions,
} from "./live-retry";

export const SITE_MONITOR_URL = "https://verifymzansi-site-monitor.verifymzansi.workers.dev/";
const PUBLIC_HOMEPAGE_URL = "https://verifymzansi.com";
const SUPABASE_HOST = /[a-z]{20}\.supabase\.co/g;

const homepageCheck = z.object({
  name: z.string(),
  status: z.enum(["PASS", "FAIL"]),
  httpStatus: z.number(),
  projectHosts: z.array(z.string()).optional(),
});
const homepageReport = z.object({
  status: z.literal("ok"),
  readiness: z.literal("ok"),
  scope: z.literal("live-service-smoke"),
  checks: z.array(homepageCheck),
});
const degradedReport = z.object({ checks: z.array(z.unknown()) });
// Printable ASCII only: a control character in a header value makes fetch
// throw an error whose message repeats the whole value.
const MONITOR_KEY = /^[!-~]{32,512}$/;

const WRONG_BACKEND = "Live homepage does not identify only the approved backend";

/** True when a served page names a Supabase project other than the approved one. */
function namesForeignProject(hosts: readonly string[] | undefined, expectedHostname: string) {
  return (hosts ?? []).some((host) => host !== expectedHostname);
}

/** Verify live origin HTML without trusting a public edge challenge or stale cache.
 * The monitor probes the active APP binding and returns hostnames, never HTML or keys.
 * Public edge/browser checks remain separate from this backend identity proof.
 * A wrong or mixed backend identity is permanent: retrying cannot fix it. */
export async function checkSiteMonitorHomepage(
  env: Readonly<Record<string, string | undefined>>,
  expectedHostname: string,
  fetchImpl: typeof fetch = fetch
) {
  const { url, fetcher } = siteMonitorTransport(env, fetchImpl);
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
  const json = response.headers.get("content-type")?.includes("application/json") === true;
  if (!response.ok || !json) {
    if (json) {
      // A degraded report can still carry a definitive identity answer.
      // Only the Homepage entries are read, so another probe's shape cannot hide it.
      const degraded = degradedReport.safeParse(
        await readLiveJson(response, "Live homepage monitor is unavailable or degraded")
      );
      if (
        degraded.success &&
        degraded.data.checks.some((entry) => {
          const check = homepageCheck.safeParse(entry);
          return (
            check.success &&
            check.data.name === "Homepage" &&
            check.data.httpStatus === 200 &&
            namesForeignProject(check.data.projectHosts, expectedHostname)
          );
        })
      )
        throw new PermanentLiveCheckError(WRONG_BACKEND);
    } else await response.body?.cancel().catch(() => {});
    throw new LiveCheckError("Live homepage monitor is unavailable or degraded");
  }
  const parsed = homepageReport.safeParse(
    await readLiveJson(response, "Live homepage monitor report is malformed")
  );
  if (!parsed.success) throw new LiveCheckError("Live homepage monitor report is malformed");
  const homepages = parsed.data.checks.filter((check) => check.name === "Homepage");
  const homepage = homepages[0];
  // A monitor that reports itself healthy has already finished every probe, so
  // a missing or mismatched homepage proof here is definitive.
  if (
    homepages.length !== 1 ||
    !homepage ||
    homepage.status !== "PASS" ||
    homepage.httpStatus !== 200 ||
    homepage.projectHosts?.length !== 1 ||
    homepage.projectHosts[0] !== expectedHostname
  )
    throw new PermanentLiveCheckError(WRONG_BACKEND);
}

/** Without a monitor credential, read the public homepage directly. */
export async function checkPublicHomepage(
  expectedHostname: string,
  fetchImpl: typeof fetch = fetch
) {
  const response = await fetchImpl(PUBLIC_HOMEPAGE_URL, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    await response.body?.cancel().catch(() => {});
    throw new LiveCheckError("Live homepage is unavailable or not HTML");
  }
  const hosts = [...new Set((await response.text()).match(SUPABASE_HOST) ?? [])];
  if (namesForeignProject(hosts, expectedHostname))
    throw new PermanentLiveCheckError(WRONG_BACKEND);
  if (hosts.length !== 1) throw new LiveCheckError("Live homepage names no backend project");
}

/** Run the homepage identity check with the bounded cold-start retry. The
 * credential still goes only through the pinned monitor transport. */
export function waitForLiveHomepage(
  env: Readonly<Record<string, string | undefined>>,
  expectedHostname: string,
  { fetchImpl = fetch, ...retry }: LiveRetryOptions & { fetchImpl?: typeof fetch } = {}
): Promise<number> {
  return retryLiveCheck(
    () =>
      env.SITE_MONITOR_API_KEY
        ? checkSiteMonitorHomepage(env, expectedHostname, fetchImpl)
        : checkPublicHomepage(expectedHostname, fetchImpl),
    retry
  );
}

/** The scoped credential is sent only to this account's fixed monitor URL. */
export function siteMonitorTransport(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch = fetch
) {
  const configured = env.SITE_MONITOR_URL || SITE_MONITOR_URL;
  const key = env.SITE_MONITOR_API_KEY;
  if (!key || !MONITOR_KEY.test(key) || configured !== SITE_MONITOR_URL)
    throw new PermanentLiveCheckError("Site monitor configuration is missing or invalid");
  if (env.SITE_MONITOR_WORKER_VERSION)
    throw new PermanentLiveCheckError("Monitor verifies live traffic only");
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
      throw new PermanentLiveCheckError("Refusing monitor credential destination");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${key}`);
    return fetchImpl(input, { ...init, headers, redirect: "error" }).then(async (response) => {
      // The monitor refused the key or the probe: a definitive answer, so the
      // credential is not presented again.
      if (response.status === 400 || response.status === 401) {
        await response.body?.cancel().catch(() => {});
        throw new PermanentLiveCheckError(
          `Site monitor refused the request (HTTP ${response.status})`
        );
      }
      return response;
    });
  };
  return { url: new URL(configured), fetcher };
}
