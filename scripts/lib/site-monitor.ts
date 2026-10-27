export const SITE_MONITOR_URL = "https://verifymzansi-site-monitor.verifymzansi.workers.dev/";

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
