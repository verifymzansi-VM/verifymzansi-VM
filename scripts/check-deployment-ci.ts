import { requireSuccessfulDeploymentCi } from "./lib/deployment-ci";

if (!process.env.GITHUB_REPOSITORY || !process.env.DEPLOY_TARGET_SHA || !process.env.GITHUB_TOKEN) {
  process.stderr.write(
    "UNAVAILABLE: deployment CI requires repository, deployed commit and GitHub read token\n"
  );
  process.exitCode = 2;
} else
  requireSuccessfulDeploymentCi(
    process.env.GITHUB_REPOSITORY ?? "",
    process.env.DEPLOY_TARGET_SHA ?? "",
    process.env.GITHUB_TOKEN ?? ""
  )
    .then(() => process.stdout.write("Deployment target has successful main-push CI.\n"))
    .catch((error: unknown) => {
      // Do not print request headers, token values or response bodies.
      console.error(error instanceof Error ? error.message : "Deployment CI verification failed");
      process.exitCode = 1;
    });
