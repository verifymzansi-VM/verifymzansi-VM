import { defineConfig, devices } from "@playwright/test";
import { readStagingTarget } from "./e2e/foundation/support/staging-target";

// Smoke test of the deployed staging copy (M0.15b): runs
// e2e/foundation/fixture-smoke.spec.ts against the staging Worker's own
// address, read from wrangler.toml [env.staging]. Nothing is started or built
// here, no secret is needed, and the target refuses any production address or
// project. The release workflow runs it after deploying staging and before
// production (deploy.yml, job deploy-staging).
//
//   pnpm exec playwright test --config=playwright.staging.config.ts
process.env.FOUNDATION_SMOKE_TARGET = "staging";
const target = readStagingTarget();

export default defineConfig({
  testDir: "./e2e/foundation",
  testMatch: "fixture-smoke.spec.ts",
  outputDir: "test-results/staging",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // A freshly deployed Worker can answer its first requests slowly.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // No skip guard: on staging the checks that need the local copy's seeded
  // people and posts are skipped by design, and the list shows why.
  reporter: [
    ["list"],
    ...(process.env.PLAYWRIGHT_JSON_REPORT
      ? [["json", { outputFile: process.env.PLAYWRIGHT_JSON_REPORT }] as const]
      : []),
  ],
  timeout: 60_000,
  use: {
    baseURL: target.appUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 45_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
});
