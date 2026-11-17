import { siteMonitorTransport } from "./lib/site-monitor";
import { waitForDeploymentHealth } from "./lib/deployment-health";
import { LiveCheckError, liveCheckFailureReason } from "./lib/live-retry";

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--"))
    throw new LiveCheckError("Unsupported monitor argument");
  const { url, fetcher } = siteMonitorTransport(process.env);
  await waitForDeploymentHealth(url, { fetchImpl: fetcher });
  console.log(
    "Authenticated app smoke checks and deep dependency readiness passed through the service binding."
  );
}
main().catch((error) => {
  // Only fixed reasons are printed; raw errors can repeat a header value.
  console.error(`Site monitor failed: ${liveCheckFailureReason(error)}`);
  process.exitCode = 1;
});
