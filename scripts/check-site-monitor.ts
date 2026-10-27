import { siteMonitorTransport } from "./lib/site-monitor";
import { waitForDeploymentHealth } from "./lib/deployment-health";

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--"))
    throw new Error("Unsupported monitor argument");
  const { url, fetcher } = siteMonitorTransport(process.env);
  await waitForDeploymentHealth(url, { fetchImpl: fetcher });
  console.log(
    "Authenticated app smoke checks and deep dependency readiness passed through the service binding."
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Site monitor failed");
  process.exitCode = 1;
});
