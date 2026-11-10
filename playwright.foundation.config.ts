import { defineConfig, devices } from "@playwright/test";
import { E2E_FIXTURE, assertLocalFoundationTarget } from "./scripts/lib/foundation-e2e-target.mjs";

// Browser tests for the restored website in foundation mode against the
// private local test copy (M0.7): a throwaway Supabase stack on 127.0.0.1
// whose database is built only from database/foundation/. The web server
// command starts (or reuses) the stack, proves the schema, seeds the test
// people and posts, builds the website and serves it on 127.0.0.1:3110.
//
//   pnpm exec playwright test --config=playwright.foundation.config.ts --project=chromium
//   node --import tsx scripts/foundation-e2e.mjs down     # delete the copy afterwards
//
// Refuse to run at all if anything in this environment names a database that
// is not the local copy (hosted Supabase, another host, a production ref).
assertLocalFoundationTarget({
  apiUrl: `http://127.0.0.1:${E2E_FIXTURE.apiPort}`,
  env: Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /SUPABASE_URL$|PROJECT_REF$|^ENVIRONMENT$/i.test(key)
    )
  ),
});

const baseURL = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

export default defineConfig({
  testDir: "./e2e/foundation",
  globalSetup: "./e2e/foundation/global.setup.ts",
  outputDir: "test-results/foundation",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // The skip guard fails a CI run on any skip that is not a documented
  // platform skip (e2e/support/skip-policy.ts). PLAYWRIGHT_JSON_REPORT adds a
  // JSON report (the CI job summarises it with scripts/e2e-foundation-summary.mjs).
  reporter: [
    ["list"],
    ...(process.env.CI
      ? [["html", { open: "never", outputFolder: "playwright-report/foundation" }] as const]
      : []),
    ["./e2e/support/skip-guard-reporter.ts"],
    ...(process.env.PLAYWRIGHT_JSON_REPORT
      ? [["json", { outputFile: process.env.PLAYWRIGHT_JSON_REPORT }] as const]
      : []),
  ],
  // PLAYWRIGHT_GLOBAL_TIMEOUT_MS stops the whole run in time for the reporters
  // to write their results, so a slow run is recorded as timed out, not cut
  // off by the CI step limit with nothing written. Unset or 0: no limit.
  globalTimeout: Number(process.env.PLAYWRIGHT_GLOBAL_TIMEOUT_MS || 0),
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 45_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node --import tsx scripts/foundation-e2e.mjs serve",
    url: `${baseURL}/api/health`,
    // Always this copy's own server: an existing one on the port cannot prove its build.
    reuseExistingServer: false,
    timeout: Number(process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS || 1_200_000),
    stdout: "pipe",
    stderr: "pipe",
  },
});
