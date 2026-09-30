import { readinessUrl, waitForDeploymentHealth } from "./lib/deployment-health";

async function main() {
  const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) throw new Error("APP_URL or NEXT_PUBLIC_APP_URL is required");
  const url = readinessUrl(baseUrl, process.env.DEPLOY_HEALTHCHECK_URL);
  const attempt = await waitForDeploymentHealth(url, {
    onRetry: (failedAttempt, error) =>
      console.warn(
        `Readiness attempt ${failedAttempt} failed: ${
          error instanceof Error ? error.message : "unknown error"
        }; retrying`
      ),
  });
  process.stdout.write(`Deployment deep readiness passed (attempt ${attempt}).\n`);
}

main().catch((error: unknown) => {
  // Never print response bodies or URLs: overrides may contain credentials.
  console.error(error instanceof Error ? error.message : "Deployment readiness check failed");
  process.exitCode = 1;
});
