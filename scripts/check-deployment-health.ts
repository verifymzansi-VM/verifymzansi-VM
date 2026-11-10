import { readinessUrl, waitForDeploymentHealth } from "./lib/deployment-health";
import { LiveCheckError, liveCheckFailureReason } from "./lib/live-retry";
import { siteMonitorTransport } from "./lib/site-monitor";

async function main() {
  const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) throw new LiveCheckError("APP_URL or NEXT_PUBLIC_APP_URL is required");
  const monitor = process.env.SITE_MONITOR_API_KEY ? siteMonitorTransport(process.env) : null;
  const url = monitor?.url ?? readinessUrl(baseUrl, process.env.DEPLOY_HEALTHCHECK_URL);
  const attempt = await waitForDeploymentHealth(url, {
    fetchImpl: monitor?.fetcher,
    onRetry: (failedAttempt, error) =>
      console.warn(
        `Readiness attempt ${failedAttempt} failed: ${liveCheckFailureReason(error)}; retrying`
      ),
  });
  process.stdout.write(`Deployment deep readiness passed (attempt ${attempt}).\n`);
}

main().catch((error: unknown) => {
  // Never print response bodies, URLs or raw errors: overrides and header
  // errors may contain credentials. Only fixed reasons are printed.
  console.error(`Deployment readiness check failed: ${liveCheckFailureReason(error)}`);
  process.exitCode = 1;
});
